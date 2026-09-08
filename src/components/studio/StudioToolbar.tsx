"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  CodeSquare,
  Link2,
  ImageIcon,
  Minus,
  Table2,
  Undo2,
  Redo2,
  type LucideIcon,
} from "lucide-react";

interface ToolbarAction {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  action: () => void;
  dividerAfter?: boolean;
}

interface StudioToolbarProps {
  onInsert: (before: string, after: string, hint: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  disabled?: boolean;
  className?: string;
}

export function StudioToolbar({
  onInsert,
  onUndo,
  onRedo,
  disabled = false,
  className,
}: StudioToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  const insertMarkdown = useCallback(
    (before: string, after: string, hint: string) => {
      if (disabled) return;
      onInsert(before, after, hint);
    },
    [onInsert, disabled]
  );

  const actions: ToolbarAction[] = [
    {
      icon: Undo2,
      label: "Undo",
      shortcut: "Ctrl+Z",
      action: () => onUndo?.(),
    },
    {
      icon: Redo2,
      label: "Redo",
      shortcut: "Ctrl+Y",
      action: () => onRedo?.(),
      dividerAfter: true,
    },
    {
      icon: Bold,
      label: "Bold",
      shortcut: "Ctrl+B",
      action: () => insertMarkdown("**", "**", "bold text"),
    },
    {
      icon: Italic,
      label: "Italic",
      shortcut: "Ctrl+I",
      action: () => insertMarkdown("*", "*", "italic text"),
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      shortcut: "Ctrl+Shift+X",
      action: () => insertMarkdown("~~", "~~", "strikethrough"),
      dividerAfter: true,
    },
    {
      icon: Heading1,
      label: "Heading 1",
      shortcut: "Ctrl+1",
      action: () => insertMarkdown("# ", "", "Heading"),
    },
    {
      icon: Heading2,
      label: "Heading 2",
      shortcut: "Ctrl+2",
      action: () => insertMarkdown("## ", "", "Subheading"),
    },
    {
      icon: Heading3,
      label: "Heading 3",
      shortcut: "Ctrl+3",
      action: () => insertMarkdown("### ", "", "Subheading"),
      dividerAfter: true,
    },
    {
      icon: List,
      label: "Bullet list",
      shortcut: "Ctrl+Shift+8",
      action: () => insertMarkdown("- ", "", "List item"),
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      shortcut: "Ctrl+Shift+7",
      action: () => insertMarkdown("1. ", "", "List item"),
    },
    {
      icon: Quote,
      label: "Blockquote",
      shortcut: "Ctrl+Shift+.",
      action: () => insertMarkdown("> ", "", "Quoted text"),
    },
    {
      icon: Code,
      label: "Inline code",
      shortcut: "Ctrl+E",
      action: () => insertMarkdown("`", "`", "code"),
    },
    {
      icon: CodeSquare,
      label: "Code block",
      shortcut: "Ctrl+Shift+K",
      action: () => insertMarkdown("```\n", "\n```", "code block"),
      dividerAfter: true,
    },
    {
      icon: Link2,
      label: "Link",
      shortcut: "Ctrl+K",
      action: () => insertMarkdown("[", "](https://)", "link text"),
    },
    {
      icon: ImageIcon,
      label: "Image",
      action: () => insertMarkdown("![", "](https://)", "alt text"),
    },
    {
      icon: Minus,
      label: "Horizontal rule",
      action: () => insertMarkdown("\n---\n", "", ""),
    },
    {
      icon: Table2,
      label: "Table",
      action: () =>
        insertMarkdown(
          "\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell 1   | Cell 2   | Cell 3   |\n",
          "",
          ""
        ),
    },
  ];

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      // Ctrl+B → Bold
      if (key === "b" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("**", "**", "bold text");
        return;
      }
      // Ctrl+I → Italic
      if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("*", "*", "italic text");
        return;
      }
      // Ctrl+E → Inline code
      if (key === "e" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("`", "`", "code");
        return;
      }
      // Ctrl+K → Link
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("[", "](https://)", "link text");
        return;
      }
      // Ctrl+Shift+X → Strikethrough
      if (key === "x" && e.shiftKey) {
        e.preventDefault();
        insertMarkdown("~~", "~~", "strikethrough");
        return;
      }
      // Ctrl+1/2/3 → Headings
      if (key === "1" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("# ", "", "Heading");
        return;
      }
      if (key === "2" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("## ", "", "Subheading");
        return;
      }
      if (key === "3" && !e.shiftKey) {
        e.preventDefault();
        insertMarkdown("### ", "", "Subheading");
        return;
      }
      // Ctrl+Shift+K → Code block
      if (key === "k" && e.shiftKey) {
        e.preventDefault();
        insertMarkdown("```\n", "\n```", "code block");
        return;
      }
      // Ctrl+Shift+. → Blockquote
      if (key === "." && e.shiftKey) {
        e.preventDefault();
        insertMarkdown("> ", "", "Quoted text");
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [insertMarkdown]);

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "flex flex-wrap items-center gap-0.5 p-1.5 rounded-xl bg-surface-900/70 border border-surface-700/50 shadow-card backdrop-blur-xl",
        className
      )}
    >
      {actions.map((item, i) => (
        <span key={i} className="contents">
          <button
            title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
            onClick={item.action}
            disabled={disabled}
            className={cn(
              "p-1.5 sm:p-2 rounded-lg transition-all",
              "text-surface-500 hover:text-brand-400 hover:bg-brand-500/10",
              "disabled:opacity-30 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            )}
          >
            <item.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          {item.dividerAfter && (
            <div className="h-5 w-px bg-surface-700/60 mx-0.5" />
          )}
        </span>
      ))}
      <div className="ml-auto hidden sm:flex items-center gap-1 text-[10px] text-surface-600 select-none">
        <kbd className="px-1 py-0.5 rounded bg-surface-800/80 border border-surface-700/40 font-mono">Ctrl</kbd>
        <span>+</span>
        <kbd className="px-1 py-0.5 rounded bg-surface-800/80 border border-surface-700/40 font-mono">B</kbd>
        <span className="text-surface-700 mx-0.5">·</span>
        <span className="text-surface-500">Markdown shortcuts</span>
      </div>
    </div>
  );
}
