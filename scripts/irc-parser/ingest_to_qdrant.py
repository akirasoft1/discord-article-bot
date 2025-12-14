#!/usr/bin/env python3
"""
IRC Chunks to Qdrant Ingestion

Embeds IRC conversation chunks and stores them in Qdrant for semantic search.

Requires:
    pip install qdrant-client openai

Usage:
    export OPENAI_API_KEY="your-key"
    python ingest_to_qdrant.py chunks.jsonl --qdrant-host localhost --qdrant-port 6333
"""

import argparse
import json
import os
import sys
import time
from typing import Generator
from dataclasses import dataclass

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        VectorParams, Distance, PointStruct,
        PayloadSchemaType, TextIndexParams, TokenizerType
    )
except ImportError:
    print("Please install qdrant-client: pip install qdrant-client", file=sys.stderr)
    sys.exit(1)

try:
    from openai import OpenAI
except ImportError:
    print("Please install openai: pip install openai", file=sys.stderr)
    sys.exit(1)


# ============================================================================
# Configuration
# ============================================================================

COLLECTION_NAME = "irc_history"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
BATCH_SIZE = 100  # Chunks per batch
EMBEDDING_BATCH_SIZE = 50  # Texts per embedding API call


# ============================================================================
# Embedding Functions
# ============================================================================

def get_embeddings(client: OpenAI, texts: list[str]) -> list[list[float]]:
    """Get embeddings for a batch of texts."""
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts
    )
    return [item.embedding for item in response.data]


def batch_iterator(items: list, batch_size: int) -> Generator:
    """Yield batches of items."""
    for i in range(0, len(items), batch_size):
        yield items[i:i + batch_size]


# ============================================================================
# Qdrant Functions
# ============================================================================

def create_collection(client: QdrantClient, collection_name: str):
    """Create the IRC history collection with proper schema."""

    # Check if collection exists
    collections = client.get_collections().collections
    if any(c.name == collection_name for c in collections):
        print(f"Collection '{collection_name}' already exists", file=sys.stderr)
        return False

    # Create collection
    client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=EMBEDDING_DIMENSIONS,
            distance=Distance.COSINE
        )
    )

    # Create payload indexes for filtering
    client.create_payload_index(
        collection_name=collection_name,
        field_name="year",
        field_schema=PayloadSchemaType.INTEGER
    )

    client.create_payload_index(
        collection_name=collection_name,
        field_name="decade",
        field_schema=PayloadSchemaType.KEYWORD
    )

    client.create_payload_index(
        collection_name=collection_name,
        field_name="channel",
        field_schema=PayloadSchemaType.KEYWORD
    )

    client.create_payload_index(
        collection_name=collection_name,
        field_name="network",
        field_schema=PayloadSchemaType.KEYWORD
    )

    client.create_payload_index(
        collection_name=collection_name,
        field_name="participants",
        field_schema=PayloadSchemaType.KEYWORD
    )

    # Full-text search on text field
    client.create_payload_index(
        collection_name=collection_name,
        field_name="text",
        field_schema=TextIndexParams(
            type="text",
            tokenizer=TokenizerType.WORD,
            min_token_len=2,
            max_token_len=20,
            lowercase=True
        )
    )

    print(f"Created collection '{collection_name}' with indexes", file=sys.stderr)
    return True


def ingest_chunks(
    qdrant_client: QdrantClient,
    openai_client: OpenAI,
    input_file: str,
    collection_name: str,
    resume_from: int = 0
):
    """Ingest chunks into Qdrant."""

    # Load all chunks
    print("Loading chunks...", file=sys.stderr)
    chunks = []
    with open(input_file, 'r', encoding='utf-8') as f:
        for line in f:
            chunks.append(json.loads(line))

    total_chunks = len(chunks)
    print(f"Loaded {total_chunks:,} chunks", file=sys.stderr)

    # Skip if resuming
    if resume_from > 0:
        chunks = chunks[resume_from:]
        print(f"Resuming from chunk {resume_from}, {len(chunks):,} remaining", file=sys.stderr)

    # Process in batches
    processed = resume_from
    start_time = time.time()

    for batch in batch_iterator(chunks, BATCH_SIZE):
        # Get texts for embedding
        texts = [chunk['text'] for chunk in batch]

        # Generate embeddings in sub-batches
        embeddings = []
        for text_batch in batch_iterator(texts, EMBEDDING_BATCH_SIZE):
            try:
                batch_embeddings = get_embeddings(openai_client, text_batch)
                embeddings.extend(batch_embeddings)
            except Exception as e:
                print(f"Error getting embeddings: {e}", file=sys.stderr)
                print(f"Processed up to chunk {processed}. Resume with --resume-from {processed}",
                      file=sys.stderr)
                return

        # Create points for Qdrant
        points = []
        for i, (chunk, embedding) in enumerate(zip(batch, embeddings)):
            point_id = processed + i + 1  # 1-indexed

            # Build payload (exclude text for smaller storage, keep for search)
            payload = {
                "chunk_id": chunk['chunk_id'],
                "session_id": chunk['session_id'],
                "channel": chunk.get('channel'),
                "target_nick": chunk.get('target_nick'),
                "network": chunk.get('network'),
                "participants": chunk.get('participants', []),
                "year": chunk.get('year'),
                "decade": chunk.get('decade'),
                "start_time": chunk.get('start_time'),
                "end_time": chunk.get('end_time'),
                "message_count": chunk.get('message_count', 0),
                "text": chunk['text']  # Keep for retrieval
            }

            points.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload=payload
            ))

        # Upsert to Qdrant
        try:
            qdrant_client.upsert(
                collection_name=collection_name,
                points=points
            )
        except Exception as e:
            print(f"Error upserting to Qdrant: {e}", file=sys.stderr)
            print(f"Processed up to chunk {processed}. Resume with --resume-from {processed}",
                  file=sys.stderr)
            return

        processed += len(batch)

        # Progress report
        elapsed = time.time() - start_time
        rate = processed / elapsed if elapsed > 0 else 0
        eta = (total_chunks - processed) / rate if rate > 0 else 0

        print(f"Processed {processed:,}/{total_chunks:,} "
              f"({100*processed/total_chunks:.1f}%) "
              f"- {rate:.1f} chunks/sec "
              f"- ETA: {eta/60:.1f} min",
              file=sys.stderr)

    print(f"\nIngestion complete! {processed:,} chunks indexed.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Ingest IRC chunks into Qdrant')
    parser.add_argument('input_file', help='Input JSONL file with chunks')
    parser.add_argument('--qdrant-host', default='localhost',
                        help='Qdrant host (default: localhost)')
    parser.add_argument('--qdrant-port', type=int, default=6333,
                        help='Qdrant port (default: 6333)')
    parser.add_argument('--collection', default=COLLECTION_NAME,
                        help=f'Collection name (default: {COLLECTION_NAME})')
    parser.add_argument('--create-collection', action='store_true',
                        help='Create collection if not exists')
    parser.add_argument('--resume-from', type=int, default=0,
                        help='Resume from chunk index (for error recovery)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Test without writing to Qdrant')

    args = parser.parse_args()

    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    # Initialize clients
    openai_client = OpenAI(api_key=api_key)
    qdrant_client = QdrantClient(host=args.qdrant_host, port=args.qdrant_port)

    print(f"Connected to Qdrant at {args.qdrant_host}:{args.qdrant_port}", file=sys.stderr)

    # Create collection if needed
    if args.create_collection:
        create_collection(qdrant_client, args.collection)

    # Dry run - just test embedding
    if args.dry_run:
        print("Dry run - testing embedding...", file=sys.stderr)
        test_text = "Hello, this is a test message"
        embeddings = get_embeddings(openai_client, [test_text])
        print(f"Got embedding with {len(embeddings[0])} dimensions", file=sys.stderr)
        return

    # Run ingestion
    ingest_chunks(
        qdrant_client,
        openai_client,
        args.input_file,
        args.collection,
        args.resume_from
    )


if __name__ == '__main__':
    main()
