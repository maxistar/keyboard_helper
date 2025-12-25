## 1. Implementation
- [ ] 1.1 Update layout data structures to include layer definitions (arrays aligned to keys; default + shift; null means no change).
- [ ] 1.2 Add rendering logic that updates legends per key without re-rendering the whole layout; apply only non-null layer entries.
- [ ] 1.3 Wire Shift key events to toggle the shift layer and revert on release.
- [ ] 1.4 Validate behavior for layouts missing a shift legend by leaving null entries untouched.
