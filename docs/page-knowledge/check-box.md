# Check Box — https://demoqa.com/checkbox

Built on `rc-tree` (not `react-checkbox-tree` — no stable `id` attributes on any node, everything
is class-based and positional).

## Full tree structure (confirmed live, all nodes)

```
Home
├── Desktop
│   ├── Notes
│   └── Commands
├── Documents
│   ├── WorkSpace
│   │   ├── React
│   │   ├── Angular
│   │   └── Veu
│   └── Office
│       ├── Public
│       ├── Private
│       ├── Classified
│       └── General
└── Downloads
    ├── Word File.doc
    └── Excel File.doc
```

## Label → internal id map

`#result` renders each selected node's internal id, not its displayed label — this mapping is not
derivable from the tree UI itself:

| Displayed label | Internal id (as it appears in `#result`) |
|---|---|
| Home | `home` |
| Desktop | `desktop` |
| Notes | `notes` |
| Commands | `commands` |
| Documents | `documents` |
| WorkSpace | `workspace` |
| React | `react` |
| Angular | `angular` |
| Veu | `veu` |
| Office | `office` |
| Public | `public` |
| Private | `private` |
| Classified | `classified` |
| General | `general` |
| Downloads | `downloads` |
| Word File.doc | `wordFile` |
| Excel File.doc | `excelFile` |

## Locators

| Element | Locator | Notes |
|---|---|---|
| A tree node (by label) | `.rc-tree-treenode` filtered to one containing a `.rc-tree-title` with that exact text | needed because `.rc-tree-treenode` alone is not scoped to one label — a naive `hasText` match on the whole row can match on a descendant's text too |
| Expand/collapse toggle | `.rc-tree-switcher` within a node | `.rc-tree-switcher_close` = collapsed, `.rc-tree-switcher_open` = expanded |
| Checkbox | `.rc-tree-checkbox` within a node | see state classes below |
| Result wrapper | `#result` | absent from the DOM entirely when nothing is selected — not just empty text |
| One selected item's text | inside `#result`, plain `text=<id>` match | use the internal id from the table above, not the label |

## Checkbox state classes

- Unchecked: `.rc-tree-checkbox` with no extra state class.
- Fully checked: `.rc-tree-checkbox.rc-tree-checkbox-checked`.
- Partial (some but not all descendants checked): `.rc-tree-checkbox.rc-tree-checkbox-indeterminate`.
  A parent only becomes `-checked` once *every* child under it is individually checked — checking
  the parent's own box instead checks every descendant at once and lands the parent on `-checked`
  directly.

## Behavior notes

- No "expand all" control exists in this markup. To reveal the whole tree, repeatedly click every
  currently-`.rc-tree-switcher_close` node until none remain — expanding a node can reveal new
  children that are themselves still collapsed, so this needs more than one pass.
- Checking a parent's checkbox selects every node in its entire subtree in one click (confirmed:
  checking "Home" alone populates `#result` with all 17 node ids).
- Unchecking the only currently-selected item removes `#result` from the DOM entirely — it does
  not become an empty wrapper.

## Source of truth

`src/ui/pages/check-box.page.ts`, `src/ui/steps/check-box.steps.ts`, `tests/ui/check-box.spec.ts`
(PET-3). Confirmed against the live site via direct DOM inspection, not inferred from screenshots.
