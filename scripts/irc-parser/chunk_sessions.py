#!/usr/bin/env python3
"""
IRC Session Chunker for Vector DB Ingestion

Takes parsed IRC sessions and breaks them into smaller chunks
suitable for vector embedding.

Chunking strategy:
- Split on time gaps > 30 minutes
- Max 20 messages per chunk
- Max ~2000 tokens per chunk
- Include metadata for filtering

Usage:
    python chunk_sessions.py parsed_logs.jsonl --output chunks.jsonl
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Generator
from dataclasses import dataclass, asdict
import hashlib


# ============================================================================
# Configuration
# ============================================================================

MAX_MESSAGES_PER_CHUNK = 20
MAX_CHARS_PER_CHUNK = 8000  # ~2000 tokens
TIME_GAP_MINUTES = 30  # Split on gaps longer than this


# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class Chunk:
    """A chunk of conversation ready for embedding."""
    chunk_id: str
    session_id: str
    source_file: str
    channel: str | None
    target_nick: str | None
    network: str | None
    participants: list
    start_time: str | None
    end_time: str | None
    year: int | None
    decade: str | None
    text: str  # Formatted conversation text for embedding
    message_count: int
    chunk_index: int  # Which chunk within the session

    def to_dict(self):
        return asdict(self)


# ============================================================================
# Chunking Functions
# ============================================================================

def parse_time(time_str: str, session_date: datetime | None) -> datetime | None:
    """Parse HH:MM time string with session date context."""
    if not time_str or not session_date:
        return None

    try:
        hour, minute = map(int, time_str.split(':'))
        return session_date.replace(hour=hour, minute=minute)
    except (ValueError, AttributeError):
        return None


def format_chunk_text(messages: list) -> str:
    """Format messages into text for embedding."""
    lines = []
    for msg in messages:
        nick = msg['nick']
        text = msg['text']
        lines.append(f"{nick}: {text}")
    return '\n'.join(lines)


def get_year_and_decade(dt: datetime | None) -> tuple:
    """Extract year and decade from datetime."""
    if not dt:
        return None, None

    year = dt.year
    decade_start = (year // 10) * 10
    decade = f"{decade_start}s"
    return year, decade


def should_split(prev_msg: dict, curr_msg: dict, session_date: datetime | None) -> bool:
    """Check if we should split between two messages based on time gap."""
    prev_time = parse_time(prev_msg['time'], session_date)
    curr_time = parse_time(curr_msg['time'], session_date)

    if not prev_time or not curr_time:
        return False

    # Handle day rollover (if current time is less than previous, assume next day)
    if curr_time < prev_time:
        curr_time += timedelta(days=1)

    gap = curr_time - prev_time
    return gap > timedelta(minutes=TIME_GAP_MINUTES)


def chunk_session(session: dict) -> Generator[Chunk, None, None]:
    """Break a session into chunks."""
    messages = session.get('messages', [])
    if not messages:
        return

    session_id = session['session_id']
    source_file = session['source_file']
    channel = session.get('channel')
    target_nick = session.get('target_nick')
    network = session.get('network')

    # Parse session start time
    session_date = None
    if session.get('start_time'):
        try:
            session_date = datetime.fromisoformat(session['start_time'])
        except (ValueError, TypeError):
            pass

    year, decade = get_year_and_decade(session_date)

    # Split into chunks
    current_chunk = []
    current_chars = 0
    chunk_index = 0

    for i, msg in enumerate(messages):
        msg_text = f"{msg['nick']}: {msg['text']}\n"
        msg_chars = len(msg_text)

        # Check if we should start a new chunk
        should_start_new = False

        # Time gap check
        if current_chunk and should_split(current_chunk[-1], msg, session_date):
            should_start_new = True

        # Size checks
        if len(current_chunk) >= MAX_MESSAGES_PER_CHUNK:
            should_start_new = True
        if current_chars + msg_chars > MAX_CHARS_PER_CHUNK:
            should_start_new = True

        # Emit current chunk if needed
        if should_start_new and current_chunk:
            # Get participants in this chunk
            chunk_participants = sorted(set(m['nick'] for m in current_chunk))

            # Generate chunk ID
            chunk_id = f"{session_id}_chunk{chunk_index:03d}"

            # Format text
            text = format_chunk_text(current_chunk)

            # Get time range
            start_time = current_chunk[0]['time'] if current_chunk else None
            end_time = current_chunk[-1]['time'] if current_chunk else None

            yield Chunk(
                chunk_id=chunk_id,
                session_id=session_id,
                source_file=source_file,
                channel=channel,
                target_nick=target_nick,
                network=network,
                participants=chunk_participants,
                start_time=start_time,
                end_time=end_time,
                year=year,
                decade=decade,
                text=text,
                message_count=len(current_chunk),
                chunk_index=chunk_index
            )

            # Reset for new chunk
            current_chunk = []
            current_chars = 0
            chunk_index += 1

        # Add message to current chunk
        current_chunk.append(msg)
        current_chars += msg_chars

    # Don't forget the last chunk
    if current_chunk:
        chunk_participants = sorted(set(m['nick'] for m in current_chunk))
        chunk_id = f"{session_id}_chunk{chunk_index:03d}"
        text = format_chunk_text(current_chunk)
        start_time = current_chunk[0]['time'] if current_chunk else None
        end_time = current_chunk[-1]['time'] if current_chunk else None

        yield Chunk(
            chunk_id=chunk_id,
            session_id=session_id,
            source_file=source_file,
            channel=channel,
            target_nick=target_nick,
            network=network,
            participants=chunk_participants,
            start_time=start_time,
            end_time=end_time,
            year=year,
            decade=decade,
            text=text,
            message_count=len(current_chunk),
            chunk_index=chunk_index
        )


def process_sessions(input_file: str, output_file: str, min_messages: int = 3):
    """Process all sessions and output chunks."""

    total_sessions = 0
    total_chunks = 0
    total_messages = 0

    with open(input_file, 'r', encoding='utf-8') as infile, \
         open(output_file, 'w', encoding='utf-8') as outfile:

        for line in infile:
            session = json.loads(line)
            total_sessions += 1

            for chunk in chunk_session(session):
                if chunk.message_count >= min_messages:
                    outfile.write(json.dumps(chunk.to_dict(), ensure_ascii=False) + '\n')
                    total_chunks += 1
                    total_messages += chunk.message_count

            if total_sessions % 100 == 0:
                print(f"Processed {total_sessions} sessions, {total_chunks} chunks...",
                      file=sys.stderr)

    print(f"\nChunking complete!", file=sys.stderr)
    print(f"  Sessions processed: {total_sessions}", file=sys.stderr)
    print(f"  Chunks created: {total_chunks}", file=sys.stderr)
    print(f"  Messages in chunks: {total_messages:,}", file=sys.stderr)
    print(f"  Avg messages per chunk: {total_messages / total_chunks:.1f}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Chunk IRC sessions for vector DB')
    parser.add_argument('input_file', help='Input JSONL file from parser')
    parser.add_argument('--output', '-o', default='chunks.jsonl',
                        help='Output JSONL file (default: chunks.jsonl)')
    parser.add_argument('--min-messages', '-m', type=int, default=3,
                        help='Minimum messages per chunk (default: 3)')

    args = parser.parse_args()
    process_sessions(args.input_file, args.output, args.min_messages)


if __name__ == '__main__':
    main()
