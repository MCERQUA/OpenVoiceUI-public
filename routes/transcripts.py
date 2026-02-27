"""
Transcript storage — saves listen-mode transcriptions to disk.

Files are organized as:
  transcripts/
    YYYY-MM-DD/
      HH-MM-SS_<slug>.txt

POST /api/transcripts/save   — save a transcript
GET  /api/transcripts        — list saved transcripts (newest first)
GET  /api/transcripts/<date>/<filename>  — read one transcript
"""

import os
import re
import json
from datetime import datetime
from flask import Blueprint, jsonify, request

transcripts_bp = Blueprint('transcripts', __name__)

TRANSCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'transcripts')


def _slug(title: str) -> str:
    """Turn a title into a safe filename slug."""
    s = title.strip().lower()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = s.strip('-')
    return s[:60] or 'untitled'


@transcripts_bp.route('/api/transcripts/save', methods=['POST'])
def save_transcript():
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or 'Untitled').strip()
    text  = (data.get('text') or '').strip()

    if not text:
        return jsonify({'error': 'No transcript text provided'}), 400

    now = datetime.now()
    date_dir  = now.strftime('%Y-%m-%d')
    time_part = now.strftime('%H-%M-%S')
    slug      = _slug(title)
    filename  = f'{time_part}_{slug}.txt'

    save_dir = os.path.join(TRANSCRIPTS_DIR, date_dir)
    os.makedirs(save_dir, exist_ok=True)

    filepath = os.path.join(save_dir, filename)

    word_count = len(text.split())
    content = (
        f'Title: {title}\n'
        f'Date:  {now.strftime("%Y-%m-%d %H:%M:%S")}\n'
        f'Words: {word_count}\n'
        f'\n---\n\n'
        f'{text}\n'
    )

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    return jsonify({
        'saved': True,
        'path':  f'transcripts/{date_dir}/{filename}',
        'date':  date_dir,
        'filename': filename,
        'words': word_count,
    })


@transcripts_bp.route('/api/transcripts', methods=['GET'])
def list_transcripts():
    entries = []
    if not os.path.isdir(TRANSCRIPTS_DIR):
        return jsonify([])

    for date_dir in sorted(os.listdir(TRANSCRIPTS_DIR), reverse=True):
        day_path = os.path.join(TRANSCRIPTS_DIR, date_dir)
        if not os.path.isdir(day_path):
            continue
        for fname in sorted(os.listdir(day_path), reverse=True):
            if not fname.endswith('.txt'):
                continue
            fpath = os.path.join(day_path, fname)
            # Read first few lines for metadata
            meta = {'title': fname, 'date': date_dir, 'filename': fname, 'words': 0}
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    for line in f:
                        if line.startswith('Title:'):
                            meta['title'] = line[6:].strip()
                        elif line.startswith('Date:'):
                            meta['timestamp'] = line[5:].strip()
                        elif line.startswith('Words:'):
                            meta['words'] = int(line[6:].strip())
                        elif line.strip() == '---':
                            break
            except Exception:
                pass
            entries.append(meta)

    return jsonify(entries)


@transcripts_bp.route('/api/transcripts/<date_dir>/<filename>', methods=['GET'])
def get_transcript(date_dir, filename):
    # Sanitize path components
    if '..' in date_dir or '..' in filename:
        return jsonify({'error': 'Invalid path'}), 400
    filepath = os.path.join(TRANSCRIPTS_DIR, date_dir, filename)
    if not os.path.isfile(filepath):
        return jsonify({'error': 'Not found'}), 404
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read(), 200, {'Content-Type': 'text/plain; charset=utf-8'}
