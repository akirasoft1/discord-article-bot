#!/usr/bin/env python3
"""
Generate Discord-to-IRC nick mapping template with fuzzy suggestions.

Usage:
    python generate_nick_mappings.py discord_users.json irc_nicks.json --output mappings.json
"""

import argparse
import json
import re
import sys
from difflib import SequenceMatcher

def normalize(s: str) -> str:
    """Normalize a string for comparison."""
    # Remove common suffixes/prefixes
    s = re.sub(r'[_\-|]+(wrk|work|away|afk|zzz|sleep|brb|food|out|home|mobile|\d+)$', '', s, flags=re.I)
    s = re.sub(r'^[_\-|]+', '', s)
    s = re.sub(r'[_\-|]+$', '', s)
    # Lowercase and remove special chars
    return re.sub(r'[^a-z0-9]', '', s.lower())

def similarity(a: str, b: str) -> float:
    """Calculate similarity between two strings."""
    norm_a = normalize(a)
    norm_b = normalize(b)
    
    # Exact normalized match
    if norm_a == norm_b:
        return 1.0
    
    # One contains the other
    if norm_a in norm_b or norm_b in norm_a:
        return 0.9
    
    # Sequence matching
    return SequenceMatcher(None, norm_a, norm_b).ratio()

def find_matches(discord_user: dict, irc_nicks: list, threshold: float = 0.6) -> list:
    """Find potential IRC nick matches for a Discord user."""
    
    # Names to check against
    discord_names = [
        discord_user.get('username', ''),
        discord_user.get('displayName', ''),
        discord_user.get('globalName', ''),
    ]
    discord_names = [n for n in discord_names if n]
    
    matches = []
    seen_nicks = set()
    
    for irc in irc_nicks:
        nick = irc['nick']
        
        # Skip if we've already matched this nick base
        nick_base = normalize(nick)
        if nick_base in seen_nicks:
            continue
        
        best_score = 0
        matched_name = None
        
        for name in discord_names:
            score = similarity(name, nick)
            if score > best_score:
                best_score = score
                matched_name = name
        
        if best_score >= threshold:
            seen_nicks.add(nick_base)
            matches.append({
                'irc_nick': nick,
                'score': round(best_score, 2),
                'matched_on': matched_name,
                'message_count': irc['message_count'],
                'years': irc['years_active'],
            })
    
    # Sort by score descending
    matches.sort(key=lambda x: (-x['score'], -x['message_count']))
    return matches[:10]  # Top 10 suggestions

def generate_mappings(discord_users: list, irc_nicks: list) -> list:
    """Generate mapping suggestions for all Discord users."""
    
    mappings = []
    
    for user in discord_users:
        suggestions = find_matches(user, irc_nicks)
        
        mapping = {
            'discord': {
                'id': user['discordId'],
                'username': user['username'],
                'displayName': user.get('displayName'),
                'globalName': user.get('globalName'),
            },
            'irc_nicks': [],  # User fills this in
            'suggestions': suggestions,
            'notes': '',  # User can add notes
        }
        
        mappings.append(mapping)
    
    return mappings

def main():
    parser = argparse.ArgumentParser(description='Generate Discord-to-IRC mappings')
    parser.add_argument('discord_users', help='Discord users JSON file')
    parser.add_argument('irc_nicks', help='IRC nicks JSON file')
    parser.add_argument('--output', '-o', default='nick_mappings.json',
                        help='Output mappings file (default: nick_mappings.json)')
    parser.add_argument('--threshold', '-t', type=float, default=0.5,
                        help='Similarity threshold for suggestions (default: 0.5)')
    
    args = parser.parse_args()
    
    # Load inputs
    with open(args.discord_users, 'r') as f:
        discord_users = json.load(f)
    
    with open(args.irc_nicks, 'r') as f:
        irc_nicks = json.load(f)
    
    print(f"Loaded {len(discord_users)} Discord users", file=sys.stderr)
    print(f"Loaded {len(irc_nicks)} IRC nicks", file=sys.stderr)
    
    # Generate mappings
    mappings = generate_mappings(discord_users, irc_nicks)
    
    # Output
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(mappings, f, indent=2, ensure_ascii=False)
    
    print(f"\nWrote mappings to {args.output}", file=sys.stderr)
    print("\nSample output:", file=sys.stderr)
    
    for mapping in mappings[:3]:
        discord = mapping['discord']
        print(f"\n  Discord: {discord['username']} ({discord.get('displayName', 'N/A')})", file=sys.stderr)
        if mapping['suggestions']:
            print(f"  Suggestions:", file=sys.stderr)
            for s in mapping['suggestions'][:3]:
                print(f"    - {s['irc_nick']} (score: {s['score']}, {s['message_count']:,} msgs)", file=sys.stderr)
        else:
            print(f"  Suggestions: (none found)", file=sys.stderr)
    
    print(f"\n\nNext steps:", file=sys.stderr)
    print(f"1. Open {args.output}", file=sys.stderr)
    print(f"2. For each user, copy desired IRC nicks from 'suggestions' to 'irc_nicks'", file=sys.stderr)
    print(f"3. Add any additional known nicks manually", file=sys.stderr)
    print(f"4. Use the finalized mappings for Qdrant queries", file=sys.stderr)

if __name__ == '__main__':
    main()
