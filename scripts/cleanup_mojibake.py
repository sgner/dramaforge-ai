"""Clean up mojibake in use-canvas-store.ts.

Strategy:
1. Pure `// mojibake` lines (126): delete entirely
2. JSDoc lines `* mojibake` (7): replace with ` * (description lost — see function name below)`
3. Trailing comment lines `code; // mojibake` (10): strip the comment, keep code
4. Verify: tsc --noEmit (manual after)

This script is idempotent (safe to re-run).
"""
import re
import io

PATH = 'components/infinite-canvas/use-canvas-store.ts'

mojibake_chars = '闂濞閻鐎闁婵濡閰琚鐓鐒閸鐜鏇鏁鐚閿鏅鍙鍐鐗鍩鍎妲绶绱绹缂缃缄缈缊缐缞缟缡缢缥缦缧缨缪缫缬缮缯缱缲缳缴缵缣鏌鐟鐔鐧鐜鐞鏉鋂錂鎔鏰鏹'
mojibake_re = re.compile('[' + mojibake_chars + ']')

with io.open(PATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
stats = {
    'pure_comment_deleted': 0,
    'jsdoc_replaced': 0,
    'trailing_comment_stripped': 0,
    'untouched': 0,
}

for i, line in enumerate(lines, 1):
    if not mojibake_re.search(line):
        new_lines.append(line)
        stats['untouched'] += 1
        continue
    stripped = line.lstrip()
    # Case 1: pure `//` line comment
    if stripped.startswith('//'):
        # Delete the line entirely
        stats['pure_comment_deleted'] += 1
        continue
    # Case 2a: JSDoc opening `/** ... */` (single line)
    if stripped.startswith('/**') and stripped.endswith('*/'):
        leading = line[:len(line) - len(line.lstrip())]
        new_lines.append(f'{leading}/** (description lost — see code below) */\n')
        stats['jsdoc_replaced'] += 1
        continue
    # Case 2b: JSDoc continuation line `* ...`
    if stripped.startswith('*') and not stripped.startswith('*/'):
        # Keep the JSDoc structure but blank the mojibake
        # The line should remain a valid JSDoc line
        # Preserve leading whitespace
        leading = line[:len(line) - len(line.lstrip())]
        # If line is ` * 闂...` keep it as ` * (description lost)`
        new_lines.append(f'{leading}* (description lost — see code below)\n')
        stats['jsdoc_replaced'] += 1
        continue
    # Case 3: JSDoc closing `*/` with mojibake — just blank
    if stripped.startswith('*/'):
        new_lines.append(' */\n')
        stats['jsdoc_replaced'] += 1
        continue
    # Case 4: Trailing comment `code; // mojibake`
    if '//' in line:
        idx = line.index('//')
        code_part = line[:idx].rstrip()
        new_lines.append(code_part + '\n')
        stats['trailing_comment_stripped'] += 1
        continue
    # Case 5: mojibake in code (string literal) — should not happen given categorization
    # But for safety, just blank the mojibake
    new_lines.append(line)
    stats['untouched'] += 1

# Write back
with io.open(PATH, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f'Cleanup complete:')
for k, v in stats.items():
    print(f'  {k}: {v}')
print(f'  Total lines: {len(lines)} -> {len(new_lines)}')
