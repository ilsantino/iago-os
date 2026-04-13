## Pattern Consistency Checks (always included)

For each modified file, identify the established patterns in the existing (unmodified) code, then verify new or modified code follows them. Flag deviations as Important unless there is an explicit code comment justifying the deviation.

### Response validation — ALWAYS Important
If existing functions in the same file validate API responses (schema checks, null guards, status code checks), new functions MUST validate responses the same way. A new function that skips response validation when siblings validate is a consistency bug, not a style choice.

### Type casting — ALWAYS Important
If existing code uses type guards (`is` functions, `instanceof`, discriminated unions) to narrow types, new code in the same file must not use bare `as` casts to bypass the type system. Flag bare `as` casts where a type guard pattern already exists in the file.

### Error handling — ALWAYS Important
If existing functions in the file use try/catch with structured error handling (logging, re-throwing typed errors, user-facing messages), new functions must follow the same pattern. A new function that silently ignores errors or uses a different error handling shape is a deviation.

### Naming conventions — ALWAYS Important
If existing functions, variables, or types in the file follow a naming convention (verb-first for functions, prefixed interfaces, consistent casing), new additions must match. Flag naming deviations with the existing pattern and the deviation.

### How to report deviations

For each deviation found, report:
- The existing pattern (quote an example from the file)
- The new code that deviates (quote the line)
- Severity: Important (or higher if the deviation introduces a bug)
- Instruction: "Existing code in this file uses pattern X. New code does not. Either follow the pattern or document why the deviation is intentional."
