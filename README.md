# Easy Columns

English | [Русский](README.ru.md)

Create and manage columns directly in your Obsidian notes. Arrange text and images side by side using the mouse, while keeping the content in Markdown.

The interface is available in Russian and English. Russian is selected by default.

## Features

- Create columns from the current text line, a supported Markdown block, or an exact selection.
- Add, resize, reorder, and delete columns using mouse controls.
- Equalize column widths and undo changes through the editor history.
- Place multiple independent column groups in one note.
- Display columns in Live Preview and Reading view.
- Stack columns vertically when the group width is 600 CSS pixels or less.

## Installation

Once the plugin is published in the official Obsidian community plugin directory:

1. Open **Settings → Community plugins** and allow community plugins.
2. Browse the plugin directory and search for **Easy Columns**.
3. Click **Install**.
4. Enable the plugin in the community plugin list.

Install updates through **Community plugins** in Obsidian settings.

## Quick start

1. Open a note in Live Preview.
2. Place the cursor on a text line or select the text you want to move into columns.
3. Open the context menu and choose **Add column**, or run **Easy Columns: Add column** from the command palette.

The content moves into the left column, and an empty column appears on the right. Without a selection, plain text uses only the current Markdown line. For lists, only the current item and its children are transferred; headings, quotes, code blocks, and tables follow their respective block boundaries. A selection is transferred exactly as selected.

### Working with columns

- Hover near either outer edge and click **+** to add a column on that side.
- Drag an internal divider to resize its two neighboring columns. Press Escape to cancel the drag.
- Double-click an internal divider to swap its neighbors together with their content and widths.
- Right-click an internal divider to add a column between its neighbors or choose a side to delete. Deleting a nonempty column requires a second click on the red confirmation button.
- Right-click text inside a group to equalize its column widths.
- Click a displayed column to open the group's Markdown source, with the cursor at the end of that column's content.

After adding a column, all widths in the group become equal. Deleting columns preserves the remaining proportions; when only one column remains, its content returns to ordinary note text.

Reading view hides controls and prevents editing inside columns. Text selection, copying, and links remain available. Task checkboxes are changed through the Markdown source.

## Settings

Open **Settings → Easy Columns**:

- Choose **Русский** or **English** to change the interface language. The selection applies immediately and is saved.
- **Tooltips**: enable or disable divider and button tooltips. Enabled by default.

## Data storage

Column content and widths are saved in `easy-columns` fenced blocks inside notes. Content uses ordinary Markdown between column separators. In Source mode, or with the plugin disabled, the source remains accessible without the column layout.

Editing uses Obsidian's main note editor. The plugin does not create separate editors inside columns or convert older callout-based column formats.

## Build from source

Node.js is required. No npm dependencies need to be installed.

```sh
npm run build
```

Alternatively, run `node scripts/build.cjs`. The three installation files are written to `dist/easy-columns/`.
