type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName?: string };
};

export function splitHighlightedText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const pattern = /==([^=\n]+?)==/g;
  let offset = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > offset) nodes.push({ type: 'text', value: value.slice(offset, match.index) });
    nodes.push({
      type: 'emphasis',
      data: { hName: 'mark' },
      children: [{ type: 'text', value: match[1] }],
    });
    offset = match.index + match[0].length;
  }

  if (!nodes.length) return [{ type: 'text', value }];
  if (offset < value.length) nodes.push({ type: 'text', value: value.slice(offset) });
  return nodes;
}

export default function remarkHighlights() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      const children: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value?.includes('==')) children.push(...splitHighlightedText(child.value));
        else {
          visit(child);
          children.push(child);
        }
      }
      node.children = children;
    };
    visit(tree);
  };
}
