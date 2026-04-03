---
name: visa-doc-translate
description: >-
  Use when translating or preparing visa and immigration documents.
  Not when doing general-purpose translation or writing content.
---

<!-- Source: ECC visa-doc-translate -->

## Purpose

Translate and prepare visa/immigration documents with attention to legal
terminology, formatting requirements, and consulate-specific conventions.

## Arguments

`/visa-doc-translate {document-path or description}` — the document to process.

Optional flags:
- `--from {language}` — source language (default: auto-detect)
- `--to {language}` — target language (default: English)
- `--consulate {country}` — target consulate for format requirements

## Steps

### 1. Analyze source document

Read the document and identify:
- Document type (passport, birth certificate, employment letter, etc.)
- Source language
- Key legal terms and proper nouns
- Formatting requirements for the target consulate

### 2. Translate

Apply translation rules:
- Preserve proper nouns (names, addresses, institution names) in original + transliteration
- Use standard legal terminology for the target language
- Maintain original document structure and formatting
- Flag ambiguous terms with translator's notes: `[TN: ...]`

### 3. Format for submission

- Add certification header: "I certify this is a true and accurate translation..."
- Include translator identification block
- Match consulate-specific formatting (margins, font guidance, notarization needs)

### 4. Save

Write to `docs/translations/{doc-type}-{language-pair}.md`.
Create directory if needed.

## Output

1. Translated document file path
2. Source and target languages
3. Document type
4. Translator's notes count (flagged ambiguities)

## Boundaries

- This is a draft translation — not a certified legal translation
- Always include disclaimer: "Review by a certified translator recommended before submission"
- Does not notarize or certify documents
- Does not dispatch agents — orchestrator translates inline
- Does not interact with consulate systems or submit documents
