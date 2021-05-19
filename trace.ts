// This is a scratch space for running tracing code output by reference_test.ts.

import {DocPair, Mode} from './reference_test'

const mode: Mode = Mode.Sync9
const a = new DocPair(0, mode)
const b = new DocPair(1, mode)
const c = new DocPair(2, mode)

const merge = (a: DocPair, b: DocPair) => a.merge(b)

// b.insert(0, 1)
// c.insert(0, 2)
// merge(c, a)
// c.insert(0, 5)
// merge(c, b)
// a.insert(0, 13)
// a.algorithm.printDoc(c.sephdoc)
// c.insert(1, 15)
// merge(a, c)


c.insert(0, 1)
b.insert(0, 2)
a.insert(0, 3)
merge(a, b)
b.insert(0, 4)
b.insert(1, 5)
a.insert(2, 6)
merge(b, c)
c.insert(0, 7)
