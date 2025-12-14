#!/usr/bin/env python3
"""
mIRC Log Parser for Vector DB Ingestion

Parses mIRC log files and outputs structured JSONL format suitable for
chunking and embedding into a vector database.

Usage:
    python parse_mirc_logs.py /path/to/logs --output parsed_logs.jsonl
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Generator
from dataclasses import dataclass, asdict
from collections import defaultdict


# ============================================================================
# mIRC Control Code Patterns
# ============================================================================

# mIRC color codes: Ctrl+C followed by 1-2 digits, optionally comma and 1-2 more
MIRC_COLOR_PATTERN = re.compile(r'\x03(\d{1,2}(,\d{1,2})?)?')

# Other mIRC formatting codes
MIRC_BOLD = '\x02'
MIRC_ITALIC = '\x1d'
MIRC_UNDERLINE = '\x1f'
MIRC_STRIKETHROUGH = '\x1e'
MIRC_REVERSE = '\x16'
MIRC_RESET = '\x0f'

# Box drawing and decorative characters from mIRC scripts
MIRC_DECORATIONS = re.compile(r'[─│┌┐└┘├┤┬┴┼═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬▀▄█▌▐░▒▓■□▪▫►◄▲▼◊○●◘◙☺☻♠♣♥♦♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼⌂]+')

# ============================================================================
# Log Line Patterns
# ============================================================================

# Session boundaries
SESSION_START_PATTERN = re.compile(r'^Session Start: (.+)$')
SESSION_CLOSE_PATTERN = re.compile(r'^Session Close: (.+)$')
SESSION_IDENT_PATTERN = re.compile(r'^Session Ident: (\S+)')

# Message patterns
# [HH:MM] [nick] message - Other user's message
OTHER_USER_MSG_PATTERN = re.compile(r'^\[(\d{1,2}:\d{2})\]\s+\[([^\]]+)\]\s+(.*)$')
# [HH:MM] (nick) message - Your message
YOUR_MSG_PATTERN = re.compile(r'^\[(\d{1,2}:\d{2})\]\s+\(([^)]+)\)\s+(.*)$')

# Noise patterns to filter out
NOISE_PATTERNS = [
    re.compile(r'^\[.*\]\s*[�★☆●○]\s*(joins|parts|quits|nick change|mode)', re.IGNORECASE),
    re.compile(r'^[�★☆●○]\s*(joins|parts|quits|nick change|mode|\[)', re.IGNORECASE),
    re.compile(r'^\*\*\*\s+(Disconnected|Retrieving|Connecting)', re.IGNORECASE),
    re.compile(r'^\[\s*topic\.\.|modes\.\.|by\.\.|time\.\.', re.IGNORECASE),
    re.compile(r'^[�_]+\[', re.IGNORECASE),  # Decorative headers
    re.compile(r'^[�]+\[', re.IGNORECASE),  # More decorative stuff
    re.compile(r'^\s*\[u@h:', re.IGNORECASE),  # Whois info
    re.compile(r'^\s*\[realname:', re.IGNORECASE),
    re.compile(r'^\s*\[channels:', re.IGNORECASE),
    re.compile(r'^\s*\[server:', re.IGNORECASE),
    re.compile(r'^\s*\[idle:', re.IGNORECASE),
    re.compile(r'^\d{2}\s*[\[\-\*]', re.IGNORECASE),  # mIRC color-coded lines starting with color numbers
    re.compile(r'^Local host:', re.IGNORECASE),
    re.compile(r'^\s*$'),  # Empty lines
]

# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class Message:
    """A single IRC message."""
    time: str
    nick: str
    text: str
    is_self: bool  # True if this is your message (parentheses format)

    def to_dict(self):
        return asdict(self)


@dataclass
class Session:
    """An IRC session (conversation)."""
    session_id: str
    source_file: str
    channel: Optional[str]
    target_nick: Optional[str]  # For DMs
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    participants: list
    messages: list
    network: Optional[str] = None

    def to_dict(self):
        d = asdict(self)
        d['start_time'] = self.start_time.isoformat() if self.start_time else None
        d['end_time'] = self.end_time.isoformat() if self.end_time else None
        d['messages'] = [m.to_dict() if hasattr(m, 'to_dict') else m for m in self.messages]
        d['message_count'] = len(self.messages)
        return d


# ============================================================================
# Parser Functions
# ============================================================================

def strip_mirc_codes(text: str) -> str:
    """Remove mIRC formatting codes from text."""
    # Remove color codes
    text = MIRC_COLOR_PATTERN.sub('', text)

    # Remove other formatting codes
    for code in [MIRC_BOLD, MIRC_ITALIC, MIRC_UNDERLINE, MIRC_STRIKETHROUGH,
                 MIRC_REVERSE, MIRC_RESET]:
        text = text.replace(code, '')

    # Remove decorative characters
    text = MIRC_DECORATIONS.sub('', text)

    return text.strip()


def is_noise_line(line: str) -> bool:
    """Check if a line is noise (join/part/quit/etc) that should be filtered."""
    cleaned = strip_mirc_codes(line)
    for pattern in NOISE_PATTERNS:
        if pattern.match(cleaned):
            return True
    return False


def parse_datetime(date_str: str) -> Optional[datetime]:
    """Parse mIRC datetime formats."""
    formats = [
        '%a %b %d %H:%M:%S %Y',  # "Tue Dec 09 18:27:34 2003"
        '%a %b %d %H:%M:%S %y',  # "Tue Dec 09 18:27:34 03" (2-digit year)
        '%a %b  %d %H:%M:%S %Y',  # Extra space for single-digit days
    ]

    date_str = date_str.strip()

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    return None


def extract_channel_info(filename: str) -> tuple:
    """Extract channel name and network from filename."""
    # Examples:
    # #Dewland.EFnet.log -> (#Dewland, EFnet)
    # #godsofthenet.EFnet.log -> (#godsofthenet, EFnet)
    # cancer.DSMnet.log -> (None, DSMnet) - DM
    # #1009689464.log -> (#1009689464, None)

    base = Path(filename).stem

    # Check for channel prefix
    is_channel = base.startswith('#') or base.startswith('@')

    # Try to extract network suffix
    parts = base.rsplit('.', 1)
    if len(parts) == 2 and not parts[1].isdigit():
        name, network = parts
    else:
        name = base
        network = None

    channel = name if is_channel else None
    target_nick = name if not is_channel else None

    return channel, target_nick, network


def parse_log_file(filepath: str) -> Generator[Session, None, None]:
    """Parse a single mIRC log file and yield Session objects."""

    channel, target_nick, network = extract_channel_info(filepath)

    current_session = None
    session_count = 0
    participants = set()

    try:
        # Try different encodings
        encodings = ['utf-8', 'cp1252', 'latin-1', 'iso-8859-1']
        content = None

        for encoding in encodings:
            try:
                with open(filepath, 'r', encoding=encoding, errors='replace') as f:
                    content = f.readlines()
                break
            except UnicodeDecodeError:
                continue

        if content is None:
            print(f"Warning: Could not read {filepath} with any encoding", file=sys.stderr)
            return

        for line in content:
            line = line.rstrip('\n\r')

            # Check for session start
            match = SESSION_START_PATTERN.match(line)
            if match:
                # Save previous session if exists and has messages
                if current_session and current_session.messages:
                    current_session.participants = sorted(list(participants))
                    yield current_session

                # Start new session
                session_count += 1
                start_time = parse_datetime(match.group(1))
                session_id = f"{Path(filepath).stem}_{session_count:04d}"

                current_session = Session(
                    session_id=session_id,
                    source_file=filepath,
                    channel=channel,
                    target_nick=target_nick,
                    start_time=start_time,
                    end_time=None,
                    participants=[],
                    messages=[],
                    network=network
                )
                participants = set()
                continue

            # Check for session close
            match = SESSION_CLOSE_PATTERN.match(line)
            if match and current_session:
                current_session.end_time = parse_datetime(match.group(1))
                continue

            # Check for session ident (updates target nick for DMs)
            match = SESSION_IDENT_PATTERN.match(line)
            if match and current_session and not channel:
                ident = match.group(1)
                if not ident.startswith('#') and ident not in ['Status', 'Window']:
                    current_session.target_nick = ident
                continue

            # Skip if no active session
            if not current_session:
                continue

            # Skip noise lines
            if is_noise_line(line):
                continue

            # Try to parse as message
            cleaned_line = strip_mirc_codes(line)

            # Try other user message pattern
            match = OTHER_USER_MSG_PATTERN.match(cleaned_line)
            if match:
                msg = Message(
                    time=match.group(1),
                    nick=match.group(2),
                    text=match.group(3).strip(),
                    is_self=False
                )
                if msg.text:  # Only add non-empty messages
                    current_session.messages.append(msg)
                    participants.add(msg.nick)
                continue

            # Try your message pattern
            match = YOUR_MSG_PATTERN.match(cleaned_line)
            if match:
                msg = Message(
                    time=match.group(1),
                    nick=match.group(2),
                    text=match.group(3).strip(),
                    is_self=True
                )
                if msg.text:
                    current_session.messages.append(msg)
                    participants.add(msg.nick)
                continue

        # Don't forget the last session
        if current_session and current_session.messages:
            current_session.participants = sorted(list(participants))
            yield current_session

    except Exception as e:
        print(f"Error parsing {filepath}: {e}", file=sys.stderr)


def parse_directory(log_dir: str, output_file: str, min_messages: int = 2):
    """Parse all log files in a directory and output to JSONL."""

    log_path = Path(log_dir)
    log_files = list(log_path.rglob('*.log'))

    print(f"Found {len(log_files)} log files", file=sys.stderr)

    stats = defaultdict(int)

    with open(output_file, 'w', encoding='utf-8') as out:
        for i, log_file in enumerate(log_files):
            if (i + 1) % 100 == 0:
                print(f"Processing {i + 1}/{len(log_files)}...", file=sys.stderr)

            try:
                for session in parse_log_file(str(log_file)):
                    if len(session.messages) >= min_messages:
                        out.write(json.dumps(session.to_dict(), ensure_ascii=False) + '\n')
                        stats['sessions'] += 1
                        stats['messages'] += len(session.messages)
                    else:
                        stats['skipped_short'] += 1

            except Exception as e:
                print(f"Error processing {log_file}: {e}", file=sys.stderr)
                stats['errors'] += 1

    print(f"\nParsing complete!", file=sys.stderr)
    print(f"  Sessions: {stats['sessions']}", file=sys.stderr)
    print(f"  Messages: {stats['messages']}", file=sys.stderr)
    print(f"  Skipped (too short): {stats['skipped_short']}", file=sys.stderr)
    print(f"  Errors: {stats['errors']}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Parse mIRC log files for vector DB ingestion')
    parser.add_argument('log_dir', help='Directory containing .log files')
    parser.add_argument('--output', '-o', default='parsed_logs.jsonl',
                        help='Output JSONL file (default: parsed_logs.jsonl)')
    parser.add_argument('--min-messages', '-m', type=int, default=2,
                        help='Minimum messages per session to include (default: 2)')
    parser.add_argument('--sample', '-s', type=int, default=0,
                        help='Only process N files (for testing)')

    args = parser.parse_args()

    parse_directory(args.log_dir, args.output, args.min_messages)


if __name__ == '__main__':
    main()
