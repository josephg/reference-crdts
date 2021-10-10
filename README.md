# Reference CRDTs

This repository contains simple proof-of-concept reference implementations of yjs, automerge and sync9's list types - all implemented in the same codebase. The implementations are reference-correct. That is, the resulting document order in all cases is the same as it is in the "real" versions (from yjs, automerge and "loom" (sync9's implementation)).

These reference implementation is (mostly) designed for readability and to show that the same codebase can handle all 3 implementations. But some complexity creeps in from overlaying all of the tricks needed for each approach. When code is only applicable to a single implementation, it is marked as such. (Eg maxSeq in document, or the alternate makeItem method for sync9).

This implementation is *not* optimized for performance. Running the automerge-perf editing history takes 30 seconds with yjs here, vs 1 second with the real, optimized yjs library.

This library does not contain all the supporting tools in yjs and automerge, like encoding / decoding or transaction support. It never will have these features.


### Whats in the box

The actual CRDT implementations share almost all their code, which lives entirely in [crdts.ts](crdts.ts). The main point of divergence is the `integrate` functions for each algorithm. These methods are called when inserting a new item, to scan the document and find the position at which the item should be inserted. This follows yjs's implementation style.

The document itself is a document-ordered list of items. Each item stores:

```typescript
export type Item<T> = {
  content: T,
  id: Id,

  originLeft: Id | null, // null for start. Aka "parent" in automerge semantics.

  originRight: Id | null, // Only used by yjs. Null for end.
  seq: number, // Only used by automerge. Larger than all known sequence numbers when created.
  insertAfter: boolean, // Only for sync9. Are we inserting before / after our parent?

  isDeleted: boolean,
}
```

IDs are tuples of `[agent: string, seq: number]`. Each peer is expected to choose an agent identifier, then each insert uses a monotonically increasing sequence number. Note item.seq (automerge's helper for local ordering) has no relation to id.seq. They should probably be called different things.


## Running the tests

I use ts-node to run the code in this project. After `npm install` / `yarn` you can run files with:

```
npx ts-node test.ts
```

## Contribution policy

Note: This code base was created for science and learning. It is not built to be a load bearing part of your infrastructure.

I have no intention of spending my time maintaining this code. If you want to make changes, please do so in a fork. I'm not interested in pull requests.


# LICENSE

Shared under the ISC license:

Copyright 2021 Joseph Gentle

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
