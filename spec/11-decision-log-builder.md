# 11 — Decision log, Builder decisions (living, dated)

> The one place where Builders record the small, reversible choices a milestone file leaves open (DL-341). Architect decisions stay in `spec/11-decision-log*.md` parts 1–4; Builders never edit those. One row per decision, newest last, ids `BD-001` onward in run order. A row never changes a contract shape: a contract change is a proposal in the milestone report. When this file nears the 6,000-word cap (`tools/ci/spec-files.ts`), the Architect moves the oldest rows to `spec/11-decision-log-builder-2.md` and leaves a pointer here.

> **Earlier rows:** Builder decisions for M00 … M01f, recorded on `claude/build` before this file existed, are in `spec/11-decision-log-builder-2.md` (M00, M00b, M01a1, M00c, M01a2) and `spec/11-decision-log-builder-3.md` (M01d, M01b1, M01c, M01f), ids `BD-M<id>-NN`. When a Builder merges `claude/architect-spec` into a code branch and `spec/11-decision-log.md` conflicts, take the spec side: the code branch's Builder section is already in those two files. New rows go in the table below only.

## Builder decisions

| ID | Milestone | Decision | Why | Reversible by |
|---|---|---|---|---|
