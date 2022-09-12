// This implements just YjsMod but uses RLE optimizations.

import assert from 'assert'
import consoleLib from 'console'
import chalk from 'chalk'

globalThis.console = new consoleLib.Console({
  stdout: process.stdout, stderr: process.stderr,
  inspectOptions: {depth: null}
})

export type Id = [agent: string, seq: number]
export type Version = Record<string, number> // Last seen seq for each agent.

// These aren't used, but they should be. They show how the items actually work for each algorithm.
type Item<T> = {
  content: T,
  id: Id,

  // Left and right implicit in document list.
  // null represents document's root / end.
  originLeft: Id | null,
  originRight: Id | null,

  isDeleted: boolean,
}

export interface Doc<T = string> {
  content: Item<T>[] // Could take Item as a type parameter, but eh. This is better for demos.

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

// We never actually compare the third argument in sync9.
const idEq2 = (a: Id | null, agent: string, seq: number): boolean => (
  a != null && (a[0] === agent && a[1] === seq)
)
const idEq = (a: Id | null, b: Id | null): boolean => (
  a == b || (a != null && b != null && a[0] === b[0] && a[1] === b[1])
)

let hits = 0
let misses = 0

// idx_hint is a small optimization so when we know the general area of
// an item, we search nearby instead of just scanning the whole document.
const findItem2 = <T>(doc: Doc<T>, needle: Id | null, atEnd: boolean = false, idx_hint: number = -1): number => {
  if (needle == null) return -1
  else {
    const [agent, seq] = needle
    // This little optimization *halves* the time to run the editing trace benchmarks.
    if (idx_hint >= 0 && idx_hint < doc.content.length) {
      const hint_item = doc.content[idx_hint]
      if ((!atEnd && idEq2(hint_item.id, agent, seq))
          || (hint_item.content != null && atEnd && idEq2(hint_item.id, agent, seq))) {
        hits++
        return idx_hint
      }
      // Try nearby.
      // const RANGE = 10
      // for (let i = idx_hint < RANGE ? 0 : idx_hint - RANGE; i < doc.content.length && i < idx_hint + RANGE; i++) {
      //   const item = doc.content[i]
      //   if ((!atEnd && idEq2(item.id, agent, seq))
      //       || (item.content != null && atEnd && idEq2(item.id, agent, seq))) {
      //     hits++
      //     return i
      //   }
      // }
    }

    misses++
    const idx = doc.content.findIndex(({content, id}) => (
      (!atEnd && idEq2(id, agent, seq)) || (content != null && atEnd && idEq2(id, agent, seq)))
    )
      // : doc.content.findIndex(({id}) => idEq(id, needle))
    if (idx < 0) throw Error('Could not find item') // Could use a ternary if not for this!
    return idx
  }
}

const findItem = <T>(doc: Doc<T>, needle: Id | null, idx_hint: number = -1): number => (
  findItem2(doc, needle, false, idx_hint)
)

// const getNextSeq = <T>(doc: Doc<T>, agent: string): number => {
//   const last = doc.version[agent]
//   return last == null ? 0 : last + 1
// }

const findItemAtPos = <T>(doc: Doc<T>, pos: number, stick_end: boolean = false): number => {
  let i = 0
  // console.log('pos', pos, doc.length, doc.content.length)
  for (; i < doc.content.length; i++) {
    const item = doc.content[i]
    if (stick_end && pos === 0) return i
    else if (item.isDeleted || item.content == null) continue
    else if (pos === 0) return i

    pos--
  }

  if (pos === 0) return i
  else throw Error('past end of the document')
}

// const nextSeq = (agent: string): number =>

export function localInsert<T>(doc: Doc<T>, agent: string, pos: number, content: T) {
  let i = findItemAtPos(doc, pos)
  integrate(doc, {
    content,
    id: [agent, (doc.version[agent] ?? -1) + 1],
    isDeleted: false,
    originLeft: doc.content[i - 1]?.id ?? null,
    originRight: doc.content[i]?.id ?? null,
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
  doc.content.filter(i => !i.isDeleted && i.content != null).map(i => i.content!)
)

export const printDoc = <T>(doc: Doc<T>) => {
  const depth: Record<string, number> = {}
  // const kForId = (id: Id, c: T | null) => `${id[0]} ${id[1]} ${id[2] ?? c != null}`
  const kForItem = (id: Id) => `${id[0]} ${id[1]}`
  for (const i of doc.content) {
    const d = i.originLeft == null ? 0 : depth[kForItem(i.originLeft)] + 1
    depth[kForItem(i.id)] = d

    let content = `${i.content == null
      ? '.'
      : i.isDeleted ? chalk.strikethrough(i.content) : chalk.yellow(i.content)
    } at [${i.id}] (parent [${i.originLeft}])`
    content += ` originRight [${i.originRight}]`
    // console.log(`${'| '.repeat(d)}${i.content == null ? chalk.strikethrough(content) : content}`)
    console.log(`${'| '.repeat(d)}${i.content == null ? chalk.grey(content) : content}`)
  }
}

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
export const mergeInto = <T>(dest: Doc<T>, src: Doc<T>) => {
  // The list of operations we need to integrate
  const missing: (Item<T> | null)[] = src.content.filter(op => op.content != null && !isInVersion(op.id, dest.version))
  let remaining = missing.length

  while (remaining > 0) {
    // Find the next item in remaining and insert it.
    let mergedOnThisPass = 0

    for (let i = 0; i < missing.length; i++) {
      const op = missing[i]
      if (op == null || !canInsertNow(op, dest)) continue
      integrate(dest, op)
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
export function integrate<T>(doc: Doc<T>, newItem: Item<T>, idx_hint: number = -1) {
  const lastSeen = doc.version[newItem.id[0]] ?? -1
  if (newItem.id[1] !== lastSeen + 1) throw Error('Operations out of order')
  doc.version[newItem.id[0]] = newItem.id[1]

  let left = findItem(doc, newItem.originLeft, idx_hint - 1)
  let destIdx = left + 1
  let right = newItem.originRight == null ? doc.content.length : findItem(doc, newItem.originRight, idx_hint)
  let scanning = false

  for (let i = destIdx; ; i++) {
    // Inserting at the end of the document. Just insert.
    if (!scanning) destIdx = i
    if (i === doc.content.length) break
    if (i === right) break // No ambiguity / concurrency. Insert here.

    let other = doc.content[i]

    let oleft = findItem(doc, other.originLeft, idx_hint - 1)
    let oright = other.originRight == null ? doc.content.length : findItem(doc, other.originRight, idx_hint)

    // The logic below summarizes to:
    // if (oleft < left || (oleft === left && oright === right && newItem.id[0] < o.id[0])) break
    // if (oleft === left) scanning = oright < right

    // Ok now we implement the punnet square of behaviour
    if (oleft < left) {
      // Top row. Insert, insert, arbitrary (insert)
      break
    } else if (oleft === left) {
      // Middle row.
      if (oright < right) {
        // This is tricky. We're looking at an item we *might* insert after - but we can't tell yet!
        scanning = true
        continue
      } else if (oright === right) {
        // Raw conflict. Order based on user agents.
        if (newItem.id[0] < other.id[0]) break
        else {
          scanning = false
          continue
        }
      } else { // oright > right
        scanning = false
        continue
      }
    } else { // oleft > left
      // Bottom row. Arbitrary (skip), skip, skip
      continue
    }
  }

  // We've found the position. Insert here.
  doc.content.splice(destIdx, 0, newItem)
  if (!newItem.isDeleted) doc.length += 1
}


// const yjsModRle: Algorithm = {
//   localInsert,
//   integrate,
//   printDoc,
// }

export const printDebugStats = () => {
  console.log('hits', hits, 'misses', misses)
}


// ;(() => {
//   // console.clear()

//   let doc1 = newDoc()

//   localInsert(doc1, 'a', 0, 'x')
//   localInsert(doc1, 'a', 1, 'y')
//   localInsert(doc1, 'a', 0, 'z') // zxy

//   // printDoc(doc1)

//   let doc2 = newDoc()

//   localInsert(doc2, 'b', 0, 'a')
//   localInsert(doc2, 'b', 1, 'b')
//   // localInsert(doc2, 'b', 2, 'c')

//   mergeInto(doc1, doc2)

//   printDoc(doc1)

//   // console.log('\n\n\n')
// })()