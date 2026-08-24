import { parseMarkdownDocument } from "@/lib/ask-aval/export";

/**
 * Renders a draft's markdown as real elements instead of dumping raw
 * "## heading" syntax at the reader. Used both for the live-streaming
 * preview (where a heading line may be mid-reveal — it just reads as a
 * plain line until the line completes) and the finished chat answer.
 */
export function MarkdownPreview({ text }: { text: string }) {
  const blocks = parseMarkdownDocument(text);
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return block.level === 1 ? <h4 key={index}>{block.text}</h4> : <h5 key={index}>{block.text}</h5>;
        }
        if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
        if (block.type === "bullets") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
            </ul>
          );
        }
        return (
          <table key={index}>
            <thead>
              <tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </>
  );
}
