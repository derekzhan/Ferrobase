import { useRef, useEffect, useCallback } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useThemeStore } from '../../stores';
import { format } from 'sql-formatter';
import { createSqlCompletionProvider } from './sqlCompletionProvider';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (sql?: string) => void;
  onSave?: () => void;
  connectionId?: string;
  database?: string;
  dbType?: string;
  language?: string;
  readOnly?: boolean;
}

export function SqlEditor({
  value,
  onChange,
  onExecute,
  onSave,
  connectionId,
  database,
  dbType,
  language = 'sql',
  readOnly = false,
}: Props) {
  const monaco = useMonaco();
  const editorRef = useRef<unknown>(null);
  const { resolvedTheme } = useThemeStore();
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);

  // Keep refs for connection info so the completion provider always reads latest
  const connectionIdRef = useRef(connectionId);
  const databaseRef = useRef(database);
  const dbTypeRef = useRef(dbType);
  connectionIdRef.current = connectionId;
  databaseRef.current = database;
  dbTypeRef.current = dbType;

  const monacoTheme = resolvedTheme === 'dark' ? 'ferrobase-dark' : 'ferrobase-light';

  // Define custom themes
  useEffect(() => {
    if (!monaco) return;

    monaco.editor.defineTheme('ferrobase-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'type', foreground: '4EC9B0' },
      ],
      colors: {
        'editor.background': '#0F172A',
        'editor.foreground': '#F1F5F9',
        'editor.lineHighlightBackground': '#1E293B',
        'editor.selectionBackground': '#2563EB44',
        'editorCursor.foreground': '#2563EB',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#94A3B8',
        'editor.inactiveSelectionBackground': '#2563EB22',
        'editorIndentGuide.background': '#334155',
        'editorGutter.background': '#0F172A',
      },
    });

    monaco.editor.defineTheme('ferrobase-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '0000FF', fontStyle: 'bold' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#0F172A',
        'editor.lineHighlightBackground': '#F8FAFC',
        'editor.selectionBackground': '#2563EB22',
        'editorCursor.foreground': '#2563EB',
        'editorLineNumber.foreground': '#CBD5E1',
        'editorLineNumber.activeForeground': '#6B7280',
      },
    });
  }, [monaco]);

  // Register SQL completion provider (once per Monaco instance)
  useEffect(() => {
    if (!monaco) return;

    // Dispose previous if any
    completionDisposableRef.current?.dispose();

    const disposable = createSqlCompletionProvider(
      monaco,
      () => connectionIdRef.current,
      () => databaseRef.current,
      () => dbTypeRef.current,
    );
    completionDisposableRef.current = disposable;

    return () => {
      disposable.dispose();
      completionDisposableRef.current = null;
    };
  }, [monaco]);

  const handleEditorMount = useCallback(
    (editor: unknown) => {
      editorRef.current = editor;
      const ed = editor as {
        addAction: (action: unknown) => void;
        addCommand: (keybinding: number, handler: () => void) => void;
      };

      // Add execute command (Cmd+Enter)
      ed.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [
          (monaco?.KeyMod.CtrlCmd ?? 2048) | (monaco?.KeyCode.Enter ?? 3),
        ],
        run: () => {
          const m = editor as { getSelection: () => unknown; getModel: () => { getValueInRange: (s: unknown) => string } | null };
          const selection = m.getSelection() as { isEmpty: () => boolean; toString: () => string } | null;
          const model = m.getModel();
          if (selection && !selection.isEmpty() && model) {
            const selectedText = model.getValueInRange(selection);
            onExecute(selectedText);
          } else {
            onExecute();
          }
        },
      });

      // Format SQL (Shift+Alt+F)
      ed.addAction({
        id: 'format-sql',
        label: 'Format SQL',
        keybindings: [
          (monaco?.KeyMod.Shift ?? 1024) |
          (monaco?.KeyMod.Alt ?? 512) |
          (monaco?.KeyCode.KeyF ?? 33),
        ],
        run: (ed: unknown) => {
          const editor = ed as { getValue: () => string; setValue: (v: string) => void };
          try {
            const formatted = format(editor.getValue(), {
              language: 'sql',
              tabWidth: 2,
              keywordCase: 'upper',
            });
            editor.setValue(formatted);
          } catch {
            // ignore format errors
          }
        },
      });

      // Save to file (Cmd+S)
      ed.addAction({
        id: 'save-sql',
        label: 'Save SQL to File',
        keybindings: [
          (monaco?.KeyMod.CtrlCmd ?? 2048) | (monaco?.KeyCode.KeyS ?? 49),
        ],
        run: () => {
          onSave?.();
        },
      });
    },
    [monaco, onExecute, onSave]
  );

  return (
    <div className="h-full w-full selectable">
      <Editor
        height="100%"
        language={language}
        value={value}
        theme={monacoTheme}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleEditorMount}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          selectionHighlight: true,
          matchBrackets: 'always',
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: false,
          readOnly,
          tabSize: 2,
          insertSpaces: true,
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          padding: { top: 8, bottom: 8 },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          suggest: {
            showKeywords: false, // We handle keywords ourselves for better sorting
            showSnippets: true,
            insertMode: 'replace',
            localityBonus: true,
            preview: true,
            showIcons: true,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          wordBasedSuggestions: 'currentDocument',
          snippetSuggestions: 'bottom',
        }}
      />
    </div>
  );
}
