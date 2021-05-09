import assert from 'assert'

export type Id = [agent: string, seq: number]
export type Version = Record<string, number> // Last seen seq for each agent.

export type Algorithm = {
  integrate: <T>(doc: Doc<T>, newItem: Item<T>, idx_hint?: number) => void
  ignoreTests?: string[]
}

export type Item<T> = {
  content: T,
  id: Id,

  // Left and right implicit in document list.
  // null represents document's root / end.
  originLeft: Id | null,
  originRight: Id | null, // Only for yjs, seph

  seq: number, // only for automerge. > all prev sequence numbers.

  isDeleted: boolean,
}

export interface Doc<T = string> {
  content: Item<T>[]
  version: Version // agent => last seen seq.
  length: number // Number of items not deleted

  maxSeq: number // Only for AM.
}

export const newDoc = <T>(): Doc<T> => ({
  content: [],
  version: {},
  length: 0,
  maxSeq: 0,
})

// **** Common code and helpers

const idEq = (a: Id | null, b: Id | null): boolean => (
  a === b || (a != null && b != null && a[0] === b[0] && a[1] === b[1])
)

let hits = 0
let misses = 0

// idx_hint is a small optimization so when we know the general area of
// an item, we search nearby instead of just scanning the whole document.
const findItem = <T>(doc: Doc<T>, needle: Id | null, idx_hint: number = -1): number => {
  if (needle == null) return -1
  else {
    // This little optimization *halves* the time to run the editing trace benchmarks.
    if (idx_hint >= 0 && idx_hint < doc.content.length) {
      if (idEq(doc.content[idx_hint].id, needle)) {
        hits++
        return idx_hint
      }
      // Try nearby.
      const RANGE = 10
      for (let i = idx_hint < RANGE ? 0 : idx_hint - RANGE; i < doc.content.length && i < idx_hint + RANGE; i++) {
        if (idEq(doc.content[i].id, needle)) {
          hits++
          return i
        }
      }
    }

    misses++
    const idx = doc.content.findIndex(({id}) => idEq(id, needle))
    if (idx < 0) throw Error('Could not find item') // Could use a ternary if not for this!
    return idx
  }
}

// const getNextSeq = <T>(doc: Doc<T>, agent: string): number => {
//   const last = doc.version[agent]
//   return last == null ? 0 : last + 1
// }

const findItemAtPos = <T>(doc: Doc<T>, pos: number): number => {
  let i = 0
  // console.log('pos', pos, doc.length, doc.content.length)
  for (; i < doc.content.length; i++) {
    const item = doc.content[i]
    if (item.isDeleted) continue
    if (pos === 0) return i
    pos--
  }

  if (pos === 0) return i
  else throw Error('past end of the document')
}

export const makeItem = <T>(content: T, idOrAgent: string | Id, originLeft: Id | null, originRight: Id | null, amSeq?: number): Item<T> => ({
  content,
  id: typeof idOrAgent === 'string' ? [idOrAgent, 0] : idOrAgent,
  isDeleted: false,
  originLeft,
  originRight,
  seq: amSeq ?? -1, // Only for AM.
})

export const localInsert = <T>(alg: Algorithm, doc: Doc<T>, agent: string, pos: number, content: T) => {
  let i = findItemAtPos(doc, pos)
  alg.integrate(doc, {
    content,
    id: [agent, (doc.version[agent] ?? -1) + 1],
    isDeleted: false,
    originLeft: doc.content[i - 1]?.id ?? null,
    originRight: doc.content[i]?.id ?? null, // Only for yjs
    seq: doc.maxSeq + 1, // Only for AM.
  }, i)
}

export const localDelete = <T>(doc: Doc<T>, agent: string, pos: number): void => {
  // This is very incomplete.
  const item = doc.content[findItemAtPos(doc, pos)]
  if (!item.isDeleted) {
    item.isDeleted = true
    doc.length -= 1
  }
}

export const getArray = <T>(doc: Doc<T>): T[] => (
  doc.content.filter(i => !i.isDeleted).map(i => i.content)
)

export const isInVersion = (id: Id | null, version: Version) => {
  if (id == null) return true
  const seq = version[id[0]]
  return seq != null && seq >= id[1]
}

export const canInsertNow = <T>(op: Item<T>, doc: Doc<T>): boolean => (
  // We need op.id to not be in doc.versions, but originLeft and originRight to be in.
  // We're also inserting each item from each agent in sequence.
  !isInVersion(op.id, doc.version)
    && (op.id[1] === 0 || isInVersion([op.id[0], op.id[1] - 1], doc.version))
    && isInVersion(op.originLeft, doc.version)
    && isInVersion(op.originRight, doc.version)
)

// Merge all missing items from src into dest.
// NOTE: This currently does not support moving deletes!
export const mergeInto = <T>(algorithm: Algorithm, dest: Doc<T>, src: Doc<T>) => {
  // The list of operations we need to integrate
  const missing: (Item<T> | null)[] = src.content.filter(op => !isInVersion(op.id, dest.version))
  let remaining = missing.length

  while (remaining > 0) {
    // Find the next item in remaining and insert it.
    let mergedOnThisPass = 0

    for (let i = 0; i < missing.length; i++) {
      const op = missing[i]
      if (op == null || !canInsertNow(op, dest)) continue
      algorithm.integrate(dest, op)
      missing[i] = null
      remaining--
      mergedOnThisPass++
    }

    assert(mergedOnThisPass)
  }
}


// *** Per algorithm integration functions. Note each CRDT will only use
// one of these integration methods depending on the desired semantics.

// This is a slight modification of yjs with a few tweaks to make some
// of the CRDT puzzles resolve better.
const integrateYjsMod = <T>(doc: Doc<T>, newItem: Item<T>, idx_hint: number = -1) => {
  const lastSeen = doc.version[newItem.id[0]] ?? -1
  if (newItem.id[1] !== lastSeen + 1) throw Error('Operations out of order')
  doc.version[newItem.id[0]] = newItem.id[1]

  let left = findItem(doc, newItem.originLeft, idx_hint - 1)
  let destIdx = left + 1
  let right = newItem.originRight == null ? doc.content.length : findItem(doc, newItem.originRight, idx_hint)
  let conflictStart = -1

  const startConflict = (i: number) => conflictStart = i
  const resetConflict = () => conflictStart = -1

  for (let i = destIdx; ; i++) {
    // Inserting at the end of the document. Just insert.
    if (conflictStart === -1) destIdx = i
    if (i === doc.content.length) break
    if (i === right) break // No ambiguity / concurrency. Insert here.

    let o = doc.content[i]

    let oleft = findItem(doc, o.originLeft, idx_hint - 1)
    let oright = o.originRight == null ? doc.content.length : findItem(doc, o.originRight, idx_hint)

    // Ok now we implement the punnet square of behaviour
    if (oleft < left) {
      // Top row. Insert, insert, arbitrary (insert)
      break
    } else if (oleft === left) {
      // Middle row.
      if (oright < right) {
        // This is tricky. We're looking at an item we *might* insert after - but we can't tell yet!
        startConflict(i)
        continue
      } else if (oright === right) {
        // Raw conflict. Order based on user agents.
        resetConflict()
        if (newItem.id[0] < o.id[0]) break
        else continue
      } else {
        resetConflict()
        continue
      }
    } else {
      // Bottom row. Arbitrary (skip), skip, skip
      continue
    }
  }

  // We've found the position. Insert here.
  doc.content.splice(destIdx, 0, newItem)
  doc.length += 1
}

const integrateYjs = <T>(doc: Doc<T>, newItem: Item<T>, idx_hint: number = -1) => {
  const lastSeen = doc.version[newItem.id[0]] ?? -1
  if (newItem.id[1] !== lastSeen + 1) throw Error('Operations out of order')
  doc.version[newItem.id[0]] = newItem.id[1]

  let left = findItem(doc, newItem.originLeft, idx_hint - 1)
  let destIdx = left + 1
  let right = newItem.originRight == null ? doc.content.length : findItem(doc, newItem.originRight, idx_hint)
  let conflictStart = -1

  const startConflict = (i: number) => conflictStart = i
  const resetConflict = () => conflictStart = -1

  for (let i = destIdx; ; i++) {
    // Inserting at the end of the document. Just insert.
    if (conflictStart === -1) destIdx = i
    if (i === doc.content.length) break
    if (i === right) break // No ambiguity / concurrency. Insert here.

    let o = doc.content[i]

    let oleft = findItem(doc, o.originLeft, idx_hint - 1)
    let oright = o.originRight == null ? doc.content.length : findItem(doc, o.originRight, idx_hint)

    // Ok now we implement the punnet square of behaviour
    if (oleft < left) {
      // Top row. Insert, insert, arbitrary (insert)
      break
    } else if (oleft === left) {
      // Middle row.
      if (newItem.id[0] > o.id[0]) {
        resetConflict()
        continue
      } else if (oright === right) {
        break
      } else {
        startConflict(i)
        continue
      }
    } else {
      // Bottom row. Arbitrary (skip), skip, skip
      continue
    }
  }

  // We've found the position. Insert here.
  doc.content.splice(destIdx, 0, newItem)
  doc.length += 1
}

const integrateAutomerge = <T>(doc: Doc<T>, newItem: Item<T>, idx_hint: number = -1) => {
  const {id} = newItem
  assert(newItem.seq >= 0)

  const lastSeen = doc.version[id[0]] ?? -1
  if (id[1] !== lastSeen + 1) throw Error('Operations out of order')
  doc.version[id[0]] = id[1]

  let parent = findItem(doc, newItem.originLeft, idx_hint - 1)
  let destIdx = parent + 1

  // Scan for the insert location. Stop if we reach the end of the document
  for (; destIdx < doc.content.length; destIdx++) {
    let o = doc.content[destIdx]

    // Optimization: This call halves the speed of this automerge
    // implementation. Its only needed to see if o.originLeft has been
    // visited in this loop, which we could calculate much more
    // efficiently.
    let oparent = findItem(doc, o.originLeft, idx_hint - 1)

    // Ok now we implement the punnet square of behaviour
    if (oparent < parent) {
      // We've gotten to the end of the list of children. Stop here.
      break
    } else if (oparent === parent) {
      // Concurrent items from different useragents are sorted first by seq then agent.

      // NOTE: For consistency with the other algorithms, adjacent items
      // are sorted in *ascending* order of useragent rather than
      // *descending* order as in the actual automerge. It doesn't
      // matter for correctness, but its something to keep in mind if
      // compatibility matters.
      if (newItem.seq > o.seq
        || newItem.seq === o.seq && id[0] < o.id[0]) break
    } else {
      // Skip child
      continue
    }
  }

  if (newItem.seq > doc.maxSeq) doc.maxSeq = newItem.seq

  // We've found the position. Insert here.
  doc.content.splice(destIdx, 0, newItem)
  doc.length += 1
}

export const yjsMod: Algorithm = {
  integrate: integrateYjsMod
}

export const yjsActual: Algorithm = {
  integrate: integrateYjs
}

export const automerge: Algorithm = {
  integrate: integrateAutomerge,

  // Automerge doesn't handle these cases as I would expect.
  ignoreTests: ['interleavingBackward', 'withTails']
}
