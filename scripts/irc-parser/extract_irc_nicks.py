#!/usr/bin/env python3
"""
Extract IRC nicks with activity stats from parsed logs.

Usage:
    python extract_irc_nicks.py /tmp/test_parsed.jsonl --top 500 --output irc_nicks.json
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime

def extract_nicks(input_file: str, top_n: int = 500) -> list:
    """Extract nicks with their activity statistics."""
    
    nick_stats = defaultdict(lambda: {
        'message_count': 0,
        'channels': set(),
        'networks': set(),
        'years_active': set(),
        'first_seen': None,
        'last_seen': None,
    })
    
    print(f"Reading {input_file}...", file=sys.stderr)
    
    with open(input_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if line_num % 500 == 0:
                print(f"  Processed {line_num} sessions...", file=sys.stderr)
            
            session = json.loads(line)
            channel = session.get('channel')
            network = session.get('network')
            start_time = session.get('start_time')
            
            year = None
            if start_time:
                try:
                    dt = datetime.fromisoformat(start_time)
                    year = dt.year
                except:
                    pass
            
            for msg in session.get('messages', []):
                nick = msg.get('nick')
                if not nick:
                    continue
                
                stats = nick_stats[nick]
                stats['message_count'] += 1
                
                if channel:
                    stats['channels'].add(channel)
                if network:
                    stats['networks'].add(network)
                if year:
                    stats['years_active'].add(year)
                
                if start_time:
                    if not stats['first_seen'] or start_time < stats['first_seen']:
                        stats['first_seen'] = start_time
                    if not stats['last_seen'] or start_time > stats['last_seen']:
                        stats['last_seen'] = start_time
    
    # Convert sets to lists and sort by message count
    results = []
    for nick, stats in nick_stats.items():
        results.append({
            'nick': nick,
            'message_count': stats['message_count'],
            'channels': sorted(stats['channels']),
            'networks': sorted(stats['networks']),
            'years_active': sorted(stats['years_active']),
            'first_seen': stats['first_seen'],
            'last_seen': stats['last_seen'],
        })
    
    # Sort by message count descending
    results.sort(key=lambda x: x['message_count'], reverse=True)
    
    print(f"\nFound {len(results)} unique nicks", file=sys.stderr)
    print(f"Returning top {top_n} by message count", file=sys.stderr)
    
    return results[:top_n]


def main():
    parser = argparse.ArgumentParser(description='Extract IRC nicks with stats')
    parser.add_argument('input_file', help='Parsed sessions JSONL file')
    parser.add_argument('--top', '-n', type=int, default=500,
                        help='Return top N nicks by message count (default: 500)')
    parser.add_argument('--output', '-o', default='irc_nicks.json',
                        help='Output JSON file (default: irc_nicks.json)')
    
    args = parser.parse_args()
    
    nicks = extract_nicks(args.input_file, args.top)
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(nicks, f, indent=2, ensure_ascii=False)
    
    print(f"\nWrote {len(nicks)} nicks to {args.output}", file=sys.stderr)
    
    # Print preview
    print("\nTop 20 nicks by message count:", file=sys.stderr)
    for i, nick in enumerate(nicks[:20], 1):
        years = f"{min(nick['years_active'])}-{max(nick['years_active'])}" if nick['years_active'] else "?"
        print(f"  {i:2}. {nick['nick']:20} {nick['message_count']:>7,} msgs  ({years})", file=sys.stderr)


if __name__ == '__main__':
    main()
