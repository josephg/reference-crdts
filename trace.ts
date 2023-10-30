// This is a scratch space for running tracing code output by reference_test.ts.

import {DocPair, Mode} from './reference_test.js'

const mode: Mode = Mode.Fugue
const a = new DocPair(0, mode)
const b = new DocPair(1, mode)
const c = new DocPair(2, mode)

const merge = (a: DocPair, b: DocPair) => a.merge(b)


a.insert(0, 2)
merge(a, c)
c.insert(0, 4)
merge(b, c)
