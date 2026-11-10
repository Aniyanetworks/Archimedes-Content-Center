import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

export interface HtmlCodeEditorHandle {
  // Puts text where the cursor is (or replaces the selection) and keeps the cursor after it.
  insert(text: string): void;
}

// A proper code editor for template HTML: colours, line numbers, search (Ctrl+F), folding and undo.
const HtmlCodeEditor = forwardRef<HtmlCodeEditorHandle, { value: string; onChange: (value: string) => void; height?: number }>(
  function HtmlCodeEditor({ value, onChange, height = 620 }, ref) {
    const scheme = useComputedColorScheme('light');
    const editor = useRef<ReactCodeMirrorRef>(null);

    useImperativeHandle(ref, () => ({
      insert(text: string) {
        const view = editor.current?.view;
        if (!view) { onChange(value + text); return; }
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
        view.focus();
      },
    }), [onChange, value]);

    return (
      <div className="code-editor">
        <CodeMirror
          ref={editor}
          value={value}
          onChange={onChange}
          height={`${height}px`}
          theme={scheme === 'dark' ? 'dark' : 'light'}
          extensions={[html(), EditorView.lineWrapping]}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true, autocompletion: true, searchKeymap: true }}
          aria-label="Template HTML"
        />
      </div>
    );
  },
);

export default HtmlCodeEditor;
