const WEIGHT_TOTAL = 2100;

function integerWeights(weights) {
  if (!weights.length || weights.length > WEIGHT_TOTAL) throw new RangeError('Недопустимое число колонок');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || weights.some(w => !Number.isFinite(w) || w <= 0)) throw new RangeError('Недопустимые веса');
  const exact = weights.map(w => w / sum * WEIGHT_TOTAL);
  const result = exact.map(w => Math.max(1, Math.floor(w)));
  let delta = WEIGHT_TOTAL - result.reduce((a, b) => a + b, 0);
  const order = weights.map((_, i) => i).sort((a, b) =>
    delta >= 0 ? (exact[b] - result[b]) - (exact[a] - result[a]) || a - b
      : (result[b] - exact[b]) - (result[a] - exact[a]) || a - b);
  while (delta !== 0) {
    for (const i of order) {
      if (!delta) break;
      if (delta > 0) { result[i]++; delta--; }
      else if (result[i] > 1) { result[i]--; delta++; }
    }
  }
  return result;
}

function resizeWeights(weights, index, fraction, minimumFraction) {
  const next = [...weights];
  const total = next[index - 1] + next[index];
  const minimum = Math.max(1, Math.ceil(total * minimumFraction));
  // A very narrow pair may have no integer position within the pixel limits.
  if (minimum > total - minimum) return next;
  next[index - 1] = Math.max(minimum, Math.min(total - minimum, Math.round(total * fraction)));
  next[index] = total - next[index - 1];
  return next;
}

function metadata(value, minimum = 2) {
  const m = /^([\deE+.,-]+)$/.exec(value);
  if (!m) return null;
  const weights = m[1].split(',').map(Number);
  if (weights.length < minimum || weights.some(w => !Number.isFinite(w) || w <= 0) || !Number.isFinite(weights.reduce((a, b) => a + b, 0))) return null;
  return { weights };
}

function groups(text) {
  const lines = text.split('\n');
  const found = [];
  let fence = null;
  let frontmatter = lines[0]?.replace(/\r$/, '') === '---';
  for (let start = 0; start < lines.length; start++) {
    const line = lines[start].replace(/\r$/, '');
    if (frontmatter) { if (start > 0 && /^(---|\.\.\.)$/.test(line)) frontmatter = false; continue; }
    const plainHeader = !fence && /^(`{4,})easy-columns\s*$/.exec(line);
    if (plainHeader) {
      let close = start + 1;
      while (close < lines.length && !new RegExp('^`{' + plainHeader[1].length + ',}\\s*$').test(lines[close].replace(/\r$/, ''))) close++;
      const body = lines.slice(start + 1, close).map(s => s.replace(/\r$/, '')).join('\n');
      const data = plainBody(body);
      const end = close < lines.length ? close + 1 : lines.length;
      found.push({ ...data, start, end, source: lines.slice(start, end).join('\n'),
        newline: lines[start].endsWith('\r') ? '\r\n' : '\n',
        closed: close < lines.length, valid: close < lines.length && data.valid });
      start = end - 1;
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
  }
  return found;
}

function emptyColumn(text = '') {
  return { text };
}

function serialize(group) {
  if (group.columns.length === 1) return group.columns[0].text.replace(/\n/g, group.newline || '\n');
  return serializePlain(group);
}

function plainBody(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const header = /^widths: ([\deE+.,-]+)$/.exec(lines[0]);
  const data = header && metadata(header[1], 1);
  const separator = /^-{3,}column-{3,}$/.test(lines[1] || '') ? lines[1] : null;
  if (!data || !separator) return { valid: false, columns: [] };
  const starts = [];
  for (let i = 1; i < lines.length; i++) if (lines[i] === separator) starts.push(i);
  const columns = starts.map((start, index) => emptyColumn(lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n')));
  return { ...data, columns, columnLines: starts, separator, valid: columns.length === data.weights.length };
}

function previewBody(source) {
  const data = plainBody(source);
  if (!data.valid && data.weights && data.columns.length && data.columns.length <= WEIGHT_TOTAL) {
    return { ...data, weights: integerWeights(data.columns.map(() => 1)), valid: true };
  }
  return data;
}

function sessionActive(session, selection) {
  return selection.ranges.some(range => range.from <= session.end && range.to >= session.start);
}

function editingSessions(sessions, transaction) {
  const finishingExit = transaction.isUserEvent('easy-columns.finish.exit');
  if (['undo', 'redo'].some(event => transaction.isUserEvent(event)) ||
    (transaction.isUserEvent('easy-columns.finish') && !finishingExit)) return [];
  if (!transaction.docChanged) return finishingExit ? sessions.filter(session => sessionActive(session, transaction.newSelection)) : sessions;
  const before = transaction.startState.doc, after = transaction.newDoc;
  const ranges = [];
  transaction.changes.iterChangedRanges((from, to, fromNew, toNew) => ranges.push({ from, to, fromNew, toNew }));
  const touched = (from, to) => ranges.some(range => range.from === range.to
    ? range.from >= from && range.from <= to : range.from < to && range.to > from);
  const covered = (from, to) => ranges.some(range => range.from <= from && range.to >= to && range.to > range.from);
  const manual = ['input', 'delete', 'move'].some(event => transaction.isUserEvent(event));
  const seed = (group, doc) => {
    const header = doc.line(group.start + 2);
    return {
      start: doc.line(group.start + 1).from, end: doc.line(group.end).to,
      headerFrom: header.from, headerTo: header.to,
      baselineCount: group.columns.length, manualWidths: false,
      markers: group.columnLines.map((line, index) => {
        const marker = doc.line(group.start + line + 2);
        return { from: marker.from, to: marker.to, weight: group.valid ? group.weights[index] : null, partial: false };
      })
    };
  };
  const pending = [...sessions];
  if (manual) {
    for (const group of groups(before.toString())) {
      if (!group.weights || !group.columns.length) continue;
      const start = before.line(group.start + 1).from;
      if (!pending.some(session => session.start === start) && touched(start, before.line(group.end).to)) pending.push(seed(group, before));
    }
  }
  const mapped = pending.filter(session => {
    if (!manual && touched(session.start, session.end)) return false;
    return !covered(session.start, session.headerFrom - 1);
  }).map(session => ({
    ...session,
    start: transaction.changes.mapPos(session.start, 1), end: transaction.changes.mapPos(session.end, -1),
    headerFrom: transaction.changes.mapPos(session.headerFrom, 1), headerTo: transaction.changes.mapPos(session.headerTo, -1),
    manualWidths: session.manualWidths || touched(session.headerFrom, session.headerTo),
    markers: session.markers.filter(marker => !covered(marker.from, marker.to)).map(marker => ({
      ...marker, partial: marker.partial || touched(marker.from, marker.to),
      from: transaction.changes.mapPos(marker.from, marker.partial ? -1 : 1), to: transaction.changes.mapPos(marker.to, -1)
    }))
  }));
  for (const group of groups(after.toString())) {
    if (!group.weights || !group.columns.length) continue;
    const start = after.line(group.start + 1).from, end = after.line(group.end).to;
    const existing = mapped.find(session => session.start === start);
    if (existing) {
      existing.end = end;
      const starts = new Set(group.columnLines.map(line => after.line(group.start + line + 2).from));
      existing.markers.forEach(marker => { if (starts.has(marker.from)) marker.partial = false; });
    }
    else if (manual && ranges.some(range => range.fromNew < end &&
      (range.toNew > start || (range.fromNew === range.toNew && range.fromNew > start)))) mapped.push(seed(group, after));
  }
  return finishingExit ? mapped.filter(session => sessionActive(session, transaction.newSelection)) : mapped;
}

function finishEditing(doc, sessions, selection = null) {
  const pending = selection ? sessions.filter(session => !sessionActive(session, selection)) : sessions;
  if (!pending.length) return [];
  const text = doc.toString();
  const changes = [];
  for (const group of groups(text)) {
    if (!group.closed || !group.weights || !group.columns.length || group.columns.length > WEIGHT_TOTAL) continue;
    const first = doc.line(group.start + 1);
    const session = pending.find(item => item.start === first.from);
    if (!session) continue;
    const starts = group.columnLines.map(line => doc.line(group.start + line + 2).from);
    const current = new Set(starts);
    if (session.markers.some(marker => !current.has(marker.from))) continue;
    if (group.columns.length === 1) {
      const bodyStart = doc.line(group.start + 4).from, closing = doc.line(group.end);
      if (bodyStart === closing.from) changes.push({ from: first.from, to: closing.to, insert: '' });
      else {
        changes.push({ from: first.from, to: bodyStart, insert: '' });
        changes.push({ from: closing.from - 1, to: closing.to, insert: '' });
      }
      continue;
    }
    if (session.manualWidths && group.valid) continue;
    const byPosition = new Map(session.markers.map(marker => [marker.from, marker.weight]));
    const remaining = starts.map(from => byPosition.get(from));
    const added = remaining.some(weight => !(weight > 0));
    if (!added && group.valid && group.columns.length === session.baselineCount) continue;
    const weights = integerWeights(added ? group.columns.map(() => 1) : remaining);
    const header = doc.line(group.start + 2), insert = 'widths: ' + weights.join(',');
    if (text.slice(header.from, header.to) !== insert) changes.push({ from: header.from, to: header.to, insert });
  }
  return changes;
}

function serializePlain(group) {
  const texts = group.columns.map(c => c.text);
  let size = 3;
  while (texts.some(text => text.split('\n').includes('-'.repeat(size) + 'column' + '-'.repeat(size)))) size++;
  const separator = '-'.repeat(size) + 'column' + '-'.repeat(size);
  const runs = texts.flatMap(text => [...text.matchAll(/`+/g)].map(m => m[0].length));
  const fence = '`'.repeat(runs.reduce((length, n) => Math.max(length, n + 1), 4));
  const lines = [fence + 'easy-columns', 'widths: ' + integerWeights(group.weights).join(',')];
  for (const text of texts) lines.push(separator, ...text.split('\n'));
  lines.push(fence);
  return lines.join(group.newline || '\n');
}

function applyAction(group, action, index) {
  const next = { ...group, columns: [...group.columns], weights: [...group.weights] };
  if (action === 'equal') next.weights.fill(1);
  else if (action === 'add' && index >= 0 && index <= next.columns.length) {
    next.columns.splice(index, 0, emptyColumn());
    next.weights = next.columns.map(() => 1);
  } else if (action === 'remove' && index >= 0 && index < next.columns.length) {
    next.columns.splice(index, 1); next.weights.splice(index, 1);
  } else if (action === 'swap' && index > 0 && index < next.columns.length) {
    [next.columns[index - 1], next.columns[index]] = [next.columns[index], next.columns[index - 1]];
    [next.weights[index - 1], next.weights[index]] = [next.weights[index], next.weights[index - 1]];
  } else throw new Error('Недопустимое действие');
  if (next.columns.length > 1) next.weights = integerWeights(next.weights);
  return next;
}

const LIST_ITEM = /^( *)(?:[-+*]|\d+[.)])[\t ]+/;
const HEADING = /^ {0,3}#{1,6}(?:[\t ]|$)/;
const QUOTE = /^ {0,3}>/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function unindent(text, width) {
  return text.split('\n').map(line => {
    let index = 0, removed = 0;
    while (index < line.length && removed < width && /[\t ]/.test(line[index])) {
      removed += line[index] === '\t' ? 4 - removed % 4 : 1;
      index++;
    }
    return ' '.repeat(Math.max(0, removed - width)) + line.slice(index);
  }).join('\n');
}

function tableRanges(lines) {
  const found = [];
  let fence = null;
  const unquote = s => s.replace(/^(?: {0,3}> ?)+/, '').replace(/\r$/, '');
  for (let i = 0; i < lines.length; i++) {
    const line = unquote(lines[i]);
    const marker = FENCE.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
    if (fence || i === 0 || /^(?: {4}|\t)/.test(line) || !line.includes('|') || !unquote(lines[i - 1]).includes('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (!cells.every(s => /^\s*:?-{3,}:?\s*$/.test(s))) continue;
    let end = i + 1;
    while (end < lines.length && unquote(lines[end]).includes('|') && unquote(lines[end]).trim()) end++;
    found.push({ start: i - 1, end });
    i = end - 1;
  }
  return found;
}

function creationBlock(text, line) {
  const original = text.split('\n'), lines = original.map(s => s.replace(/\r$/, '').replace(/^[\t ]+/, indent => {
    let width = 0;
    for (const ch of indent) width += ch === '\t' ? 4 - width % 4 : 1;
    return ' '.repeat(width);
  }));
  if (line < 0 || line >= lines.length || groups(text).some(g => line >= g.start && line < g.end)) return null;
  const tables = tableRanges(lines);
  const result = (start, end) => ({ start, end, source: original.slice(start, end).join('\n') });
  let first = 0;
  if (lines[0] === '---') {
    const close = lines.findIndex((s, i) => i > 0 && /^(---|\.\.\.)$/.test(s));
    if (close < 0 || line <= close) return null;
    first = close + 1;
  }
  const rule = s => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(s);
  const startsBlock = s => HEADING.test(s) || QUOTE.test(s) || FENCE.test(s) || LIST_ITEM.test(s) || rule(s);
  const fenceEnd = (start, marker) => {
    let end = start + 1;
    while (end < lines.length) {
      const close = FENCE.exec(lines[end]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length && /^ {0,3}(`+|~+)\s*$/.test(lines[end])) return end + 1;
      end++;
    }
    return end;
  };
  const listItems = [];
  const listEnd = start => {
    const indent = LIST_ITEM.exec(lines[start])[1].length;
    let end = start + 1;
    while (end < lines.length) {
      const current = lines[end], item = LIST_ITEM.exec(current);
      if (item) {
        if (item[1].length <= indent) break;
        const childEnd = listEnd(end);
        listItems.push({ start: end, end: childEnd });
        end = childEnd; continue;
      }
      if (!current.trim()) {
        let next = end + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next >= lines.length || lines[next].search(/\S/) <= indent) break;
        end = next; continue;
      }
      const spaces = current.search(/\S/);
      if (spaces <= indent && startsBlock(current)) break;
      // Fences indented into a list item belong to that item, including literal list markers.
      const fence = FENCE.exec(current.slice(indent + 2));
      if (fence) {
        let stop = end + 1;
        while (stop < lines.length) {
          const inner = lines[stop].slice(indent + 2), close = FENCE.exec(inner);
          if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length && /^ {0,3}(`+|~+)\s*$/.test(inner)) { stop++; break; }
          stop++;
        }
        end = stop; continue;
      }
      end++;
    }
    return end;
  };
  for (let start = first; start < lines.length;) {
    let end = start + 1;
    const current = lines[start], fence = FENCE.exec(current);
    if (tables.some(t => start >= t.start && start < t.end)) {
      end = tables.find(t => start >= t.start && start < t.end).end;
      if (line >= start && line < end) return result(start, end);
    } else if (fence) end = fenceEnd(start, fence[1]);
    else if (QUOTE.test(current)) {
      while (end < lines.length && (QUOTE.test(lines[end]) || (lines[end].trim() && !startsBlock(lines[end])))) end++;
    } else if (LIST_ITEM.test(current) && LIST_ITEM.exec(current)[1].length < 4 && !rule(current)) {
      listItems.length = 0;
      end = listEnd(start);
      if (line >= start && line < end) {
        const item = listItems.filter(item => line >= item.start && line < item.end).sort((a, b) => b.start - a.start)[0];
        const block = item ? result(item.start, item.end) : result(start, end);
        return block && { ...block, listIndent: LIST_ITEM.exec(lines[block.start])[1].length };
      }
    } else if (/^(?: {4}|\t)/.test(current)) {
      while (end < lines.length && (/^(?: {4}|\t)/.test(lines[end]) || (!lines[end].trim() && /^(?: {4}|\t)/.test(lines[end + 1] || '')))) end++;
    } else if (current.trim() && !HEADING.test(current) && !rule(current)) {
      if (/^ {0,3}(?:=+|-+)\s*$/.test(lines[end] || '')) end++;
    }
    if (line >= start && line < end) return rule(current) ? null : result(start, end);
    start = end;
  }
  return null;
}

function selectedBlock(text, from, to) {
  const lines = text.split('\n');
  const last = to.ch === 0 ? to.line - 1 : to.line;
  if (groups(text).some(g => from.line < g.end && last >= g.start)) return null;
  const offset = pos => lines.slice(0, pos.line).reduce((n, s) => n + s.length + 1, 0) + pos.ch;
  const start = offset(from), end = offset(to);
  const source = text.slice(start, end);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const left = text.slice(0, start), right = text.slice(end);
  const before = !left || left.endsWith(newline + newline) ? '' : left.endsWith(newline) ? newline : newline + newline;
  const after = !right || right.startsWith(newline + newline) ? '' : right.startsWith(newline) ? newline : newline + newline;
  return { from, to, source, before, after };
}

module.exports = { metadata, groups, emptyColumn, serialize, applyAction, creationBlock, selectedBlock, unindent, integerWeights, resizeWeights, WEIGHT_TOTAL, plainBody, previewBody, sessionActive, editingSessions, finishEditing };
