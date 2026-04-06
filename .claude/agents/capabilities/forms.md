# Form Handling Patterns

## React Hook Form + Zod
- Define a Zod schema first, then infer the TypeScript type from it: `type FormData = z.infer<typeof schema>`
- Pass the inferred type to `useForm`: `useForm<FormData>({ resolver: zodResolver(schema) })`
- Manage all form state through React Hook Form — do not use `useState` for field values

## ShadCN Component Integration
- Use `Controller` from React Hook Form to wrap ShadCN controlled inputs (Select, Checkbox, RadioGroup, etc.)
- Pass `control` from `useForm` into each `Controller` — never register ShadCN components with `register`

## Server Validation Errors
- After a failed mutation, map API error responses to specific fields using `setError("fieldName", { message: "..." })`
- Display field-level server errors alongside client-side Zod errors using the same error display path
- Reserve `setError("root")` for non-field errors such as network failures or permission denials
