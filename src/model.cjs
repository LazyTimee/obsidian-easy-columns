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
  const first = /^(-{3,})column(?:\[([^\]]*)\])?(-{3,})$/.exec(lines[0]);
  if (first) {
    const separator = first[1] + 'column' + first[3];
    const starts = [], weights = [];
    let damaged = false;
    for (let i = 0; i < lines.length; i++) {
      const marker = /^(-{3,})column(?:\[([^\]]*)\])?(-{3,})$/.exec(lines[i]);
      if (lines[i].startsWith(first[1] + 'column[') && !marker) damaged = true;
      if (!marker || marker[1] + 'column' + marker[3] !== separator) continue;
      starts.push(i);
      const value = metadata(marker[2] || '', 1);
      weights.push(value?.weights.length === 1 ? value.weights[0] : null);
    }
    const columns = starts.map((start, index) => emptyColumn(lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n')));
    return { format: 'inline', columns, weights, columnLines: starts, separator,
      valid: !damaged && columns.length <= WEIGHT_TOTAL && weights.every(weight => weight > 0) && Number.isFinite(weights.reduce((sum, weight) => sum + weight, 0)) };
  }
  const header = /^widths: ([\deE+.,-]+)$/.exec(lines[0]);
  const data = header && metadata(header[1], 1);
  const separator = /^-{3,}column-{3,}$/.test(lines[1] || '') ? lines[1] : null;
  if (!data || !separator) return { valid: false, columns: [] };
  const starts = [];
  for (let i = 1; i < lines.length; i++) if (lines[i] === separator) starts.push(i);
  const columns = starts.map((start, index) => emptyColumn(lines.slice(start + 1, starts[index + 1] ?? lines.length).join('\n')));
  return { ...data, format: 'legacy', columns, columnLines: starts, separator, valid: columns.length === data.weights.length && columns.length <= WEIGHT_TOTAL };
}

function previewBody(source) {
  return plainBody(source);
}

function weightedSeparator(separator, weight) {
  return separator.replace('column', 'column[' + weight + ']');
}

function weightChanges(doc, group, weights = group.weights) {
  if (!group.valid || weights.length !== group.columns.length) return [];
  const text = doc.toString();
  const separator = group.format === 'legacy' ? safeSeparator(group.columns.map(column => column.text), group.separator.indexOf('column')) : group.separator;
  const changes = [];
  if (group.format === 'legacy') {
    const header = doc.line(group.start + 2), marker = doc.line(group.start + 3);
    changes.push({ from: header.from, to: marker.from, insert: '' });
  }
  group.columnLines.forEach((line, index) => {
    const marker = doc.line(group.start + line + 2);
    const ending = text.slice(marker.from, marker.to).endsWith('\r') ? '\r' : '';
    const insert = weightedSeparator(separator, weights[index]) + ending;
    if (text.slice(marker.from, marker.to) !== insert) changes.push({ from: marker.from, to: marker.to, insert });
  });
  return changes;
}

function sessionActive(session, selection) {
  return selection.ranges.some(range => range.from <= session.end && range.to >= session.start);
}

function editingSessions(sessions, transaction) {
  const finishingExit = transaction.isUserEvent('easy-columns.finish.exit');
  if (['undo', 'redo'].some(event => transaction.isUserEvent(event)) ||
    (transaction.isUserEvent('easy-columns.finish') && !finishingExit)) return [];
  const before = transaction.startState.doc, after = transaction.newDoc;
  const ranges = [];
  transaction.changes.iterChangedRanges((from, to, fromNew, toNew) => ranges.push({ from, to, fromNew, toNew }));
  const touched = (from, to) => ranges.some(range => range.from === range.to
    ? range.from >= from && range.from <= to : range.from < to && range.to > from);
  const covered = (from, to) => ranges.some(range => range.from <= from && range.to >= to && range.to > range.from);
  const manual = ['input', 'delete', 'move'].some(event => transaction.isUserEvent(event));
  const seed = (group, doc) => {
    const opening = doc.line(group.start + 1);
    return {
      start: opening.from, end: doc.line(group.end).to, openingEnd: opening.to,
      baselineCount: group.columns.length,
      markers: group.columnLines.map(line => {
        const marker = doc.line(group.start + line + 2);
        return { from: marker.from, to: marker.to, partial: false };
      })
    };
  };
  if (!transaction.docChanged) {
    if (finishingExit) return sessions.filter(session => sessionActive(session, transaction.newSelection));
    if (transaction.newSelection.ranges.every(range => sessions.some(session => range.from >= session.start && range.to <= session.end))) return sessions;
    const pending = [...sessions];
    if (transaction.startState.selection) for (const group of groups(before.toString())) {
      if (!group.weights || !group.columns.length) continue;
      const session = seed(group, before);
      if (!pending.some(item => item.start === session.start) &&
        (sessionActive(session, transaction.startState.selection) || sessionActive(session, transaction.newSelection))) pending.push(session);
    }
    return pending;
  }
  const pending = [...sessions];
  const tracked = () => ranges.every(range => pending.some(session => range.from >= session.start && range.to <= session.end));
  if (manual && !tracked()) {
    for (const group of groups(before.toString())) {
      if (!group.weights || !group.columns.length) continue;
      const start = before.line(group.start + 1).from;
      if (!pending.some(session => session.start === start) && touched(start, before.line(group.end).to)) pending.push(seed(group, before));
    }
  }
  const knownEdit = tracked();
  const mapped = pending.filter(session => {
    if (!manual && touched(session.start, session.end)) return false;
    return !covered(session.start, session.openingEnd);
  }).map(session => ({
    ...session,
    start: transaction.changes.mapPos(session.start, 1), end: transaction.changes.mapPos(session.end, -1),
    openingEnd: transaction.changes.mapPos(session.openingEnd, -1),
    markers: session.markers.filter(marker => !covered(marker.from, marker.to)).map(marker => ({
      ...marker, partial: marker.partial || touched(marker.from, marker.to),
      from: transaction.changes.mapPos(marker.from, marker.partial || touched(marker.from, marker.to) ? -1 : 1), to: transaction.changes.mapPos(marker.to, -1)
    }))
  }));
  // Inside a tracked block only positions are mapped. Parse content again on exit.
  if (manual && !knownEdit) for (const group of groups(after.toString())) {
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
    if (!group.closed || !group.valid || !group.weights || !group.columns.length || group.columns.length > WEIGHT_TOTAL) continue;
    const first = doc.line(group.start + 1);
    const session = pending.find(item => item.start === first.from);
    if (!session) continue;
    const starts = group.columnLines.map(line => doc.line(group.start + line + 2).from);
    const current = new Set(starts);
    if (session.markers.some(marker => !current.has(marker.from))) continue;
    if (group.columns.length === 1) {
      const bodyStart = doc.line(group.start + group.columnLines[0] + 3).from, closing = doc.line(group.end);
      if (bodyStart === closing.from) changes.push({ from: first.from, to: closing.to, insert: '' });
      else {
        changes.push({ from: first.from, to: bodyStart, insert: '' });
        changes.push({ from: closing.from - 1, to: closing.to, insert: '' });
      }
      continue;
    }
    if (group.format === 'inline') {
      if (group.columns.length !== session.baselineCount) changes.push(...weightChanges(doc, group, integerWeights(group.weights)));
      continue;
    }
    changes.push(...weightChanges(doc, group));
  }
  return changes;
}

function safeSeparator(texts, minimum = 3) {
  let size = minimum;
  while (texts.some(text => text.split('\n').some(line => {
    const marker = /^(-{3,})column(?:\[[^\]]*\])?(-{3,})$/.exec(line);
    return (marker && marker[1].length === size && marker[2].length === size) || line.startsWith('-'.repeat(size) + 'column[');
  }))) size++;
  return '-'.repeat(size) + 'column' + '-'.repeat(size);
}

function serializePlain(group) {
  const texts = group.columns.map(c => c.text);
  const separator = safeSeparator(texts);
  const runs = texts.flatMap(text => [...text.matchAll(/`+/g)].map(m => m[0].length));
  const fence = '`'.repeat(runs.reduce((length, n) => Math.max(length, n + 1), 4));
  const weights = integerWeights(group.weights);
  const lines = [fence + 'easy-columns'];
  for (const [index, text] of texts.entries()) lines.push(weightedSeparator(separator, weights[index]), ...text.split('\n'));
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

// A searchable source view, with hidden destinations removed and UTF-16 positions retained.
// Rendering remains Obsidian's job; an unmatched DOM fragment is never guessed.
function clickSource(text, decodeEntity = value => value) {
  let visible = '', fence = null;
  const starts = [], ends = [], images = [];
  const append = (value, from, to) => {
    visible += value;
    for (let n = 0; n < value.length; n++) { starts.push(from); ends.push(to); }
  };
  const closing = (from, open, close) => {
    let depth = 1;
    for (let i = from + 1; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === open) depth++;
      if (text[i] === close && --depth === 0) return i;
    }
    return -1;
  };
  for (let i = 0; i < text.length;) {
    if (i === 0 || text[i - 1] === '\n') {
      const line = text.slice(i).split('\n', 1)[0];
      const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()))) {
        fence = fence ? null : marker[1]; i += line.length; continue;
      }
      if (!fence) {
        if (/^\s{0,3}\[[^\]]+\]:\s/.test(line)) { i += line.length; continue; }
        const prefix = /^(?:\s{0,3}>\s?)*(?:\s{0,3}#{1,6}\s+|\s*[-+*]\s+(?:\[[ xX]\]\s+)?|\s*\d+[.)]\s+)?/.exec(line)[0];
        i += prefix.length;
        if (!text[i] || text[i] === '\n') { if (text[i]) append(text[i], i, ++i); continue; }
      }
    }
    if (fence) { append(text[i], i, i + 1); i++; continue; }
    if (text[i] === '`') {
      const ticks = /^`+/.exec(text.slice(i))[0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end >= 0) {
        for (let p = i + ticks.length; p < end; p++) append(text[p] === '\n' ? ' ' : text[p], p, p + 1);
        i = end + ticks.length; continue;
      }
    }
    const image = text.startsWith('![', i), start = image ? i + 1 : i;
    if (text.startsWith('[[', start)) {
      const end = text.indexOf(']]', start + 2);
      if (end >= 0) {
        if (image) { images.push({ from: i, to: end + 2, at: visible.length }); append('\ufffc', i, end + 2); }
        else {
          const pipe = text.indexOf('|', start + 2);
          const from = pipe >= 0 && pipe < end ? pipe + 1 : start + 2;
          for (let p = from; p < end; p++) append(text[p], p, p + 1);
        }
        i = end + 2; continue;
      }
    }
    if (text[start] === '[') {
      const labelEnd = closing(start, '[', ']');
      let end = labelEnd;
      if (labelEnd >= 0 && text[labelEnd + 1] === '(') end = closing(labelEnd + 1, '(', ')');
      else if (labelEnd >= 0 && text[labelEnd + 1] === '[') end = closing(labelEnd + 1, '[', ']');
      if (labelEnd >= 0 && end > labelEnd) {
        if (image) { images.push({ from: i, to: end + 1, at: visible.length }); append('\ufffc', i, end + 1); }
        else for (let p = start + 1; p < labelEnd; p++) append(text[p], p, p + 1);
        i = end + 1; continue;
      }
    }
    if (text[i] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[i + 1] || '')) {
      append(text[i + 1], i, i + 2); i += 2; continue;
    }
    const entity = text[i] === '&' && /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.exec(text.slice(i));
    if (entity) { append(decodeEntity(entity[0]), i, i + entity[0].length); i += entity[0].length; continue; }
    const tag = text[i] === '<' && /^(?:<\/?[a-z][^>]*>|<!--[\s\S]*?-->)/i.exec(text.slice(i));
    if (tag) { i += tag[0].length; continue; }
    append(text[i], i, i + 1); i++;
  }
  return { text: visible, starts, ends, images };
}

module.exports = { metadata, groups, emptyColumn, serialize, applyAction, creationBlock, selectedBlock, unindent, integerWeights, resizeWeights, WEIGHT_TOTAL, plainBody, previewBody, sessionActive, editingSessions, finishEditing, weightChanges, clickSource };
