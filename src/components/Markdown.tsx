// EasyWork - Markdown renderer using react-markdown
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface Props {
  content: string;
}

export default function Markdown({ content }: Props) {
  // Pre-process special syntax before markdown parsing
  const processed = content
    .replace(/(【)(.+?)(】)/g, '<span class="text-brand-600 font-medium">$1$2$3</span>')
    .replace(/\[待确认\]/g, '<span class="text-amber-600 font-medium">[待确认]</span>');

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        h1: ({ children }) => <h1 className="text-2xl font-semibold text-gray-900 mt-6 mb-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-semibold text-gray-900 mt-5 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">{children}</h3>,
        h4: ({ children }) => <h4 className="text-base font-semibold text-gray-900 mt-3 mb-1">{children}</h4>,
        h5: ({ children }) => <h5 className="text-sm font-semibold text-gray-900 mt-2 mb-1">{children}</h5>,
        h6: ({ children }) => <h6 className="text-xs font-semibold text-gray-900 mt-2 mb-1">{children}</h6>,
        p: ({ children }) => <p className="text-sm text-gray-700 leading-relaxed my-1.5">{children}</p>,
        hr: () => <hr className="my-4 border-gray-200" />,
        table: ({ children }) => <table className="min-w-full border-collapse my-2 text-sm">{children}</table>,
        th: ({ children }) => <th className="border px-3 py-1.5 bg-gray-50 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border px-3 py-1.5">{children}</td>,
        ul: ({ children }) => <ul className="space-y-1.5 my-2 ml-4 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="space-y-1.5 my-2 ml-4 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="text-sm text-gray-700">{children}</li>,
        pre: ({ children }) => <pre className="text-sm bg-gray-100 rounded p-3 my-2 overflow-x-auto">{children}</pre>,
        code: ({ children }) => <code className="text-xs bg-gray-100 px-1 rounded">{children}</code>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        a: ({ href, children }) => <a href={href} className="text-brand-600 underline hover:no-underline" target="_blank" rel="noopener noreferrer">{children}</a>,
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
