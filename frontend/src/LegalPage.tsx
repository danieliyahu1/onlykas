import type { PublicPage } from "@kaskama/shared";

export function LegalPage({ page }: { page: PublicPage }) {
  return (
    <article className="legal-page">
      <h1>{page.heading}</h1>
      <p className="legal-updated">Last updated: {page.updated}</p>
      {page.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {page.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
