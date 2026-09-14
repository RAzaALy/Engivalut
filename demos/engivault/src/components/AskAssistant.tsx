import { Fragment, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import "./AskAssistant.css";

interface AskSource {
	type: "article" | "adr" | "incident";
	title: string;
	slug: string;
	url: string;
	description?: string;
}

interface AskResponse {
	answer: string;
	sources: AskSource[];
}

const TYPE_LABEL: Record<AskSource["type"], string> = {
	article: "Article",
	adr: "ADR",
	incident: "Incident",
};

const EXAMPLE_QUESTIONS = [
	"Why did we choose PostgreSQL?",
	"What caused the API latency incident?",
	"What are our frontend performance guidelines?",
	"When should we use REST instead of GraphQL?",
	"What architecture decisions have we made around Astro?",
];

type Status = "idle" | "loading" | "success" | "error";

/**
 * Deliberately tiny markdown subset (bold + bullet lists) — the model is
 * asked for concise technical answers, not full markdown documents, and
 * this avoids pulling in a markdown dependency or using
 * dangerouslySetInnerHTML on LLM output.
 */
function renderInline(text: string): ReactNode {
	return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			return <strong key={i}>{part.slice(2, -2)}</strong>;
		}
		return <Fragment key={i}>{part}</Fragment>;
	});
}

function renderAnswer(answer: string): ReactNode {
	return answer
		.trim()
		.split(/\n{2,}/)
		.map((block, i) => {
			const lines = block.split("\n").filter((line) => line.trim().length > 0);
			const isList = lines.length > 0 && lines.every((line) => /^[*-]\s+/.test(line.trim()));

			if (isList) {
				return (
					<ul className="ask-answer-list" key={i}>
						{lines.map((line, j) => (
							<li key={j}>{renderInline(line.trim().replace(/^[*-]\s+/, ""))}</li>
						))}
					</ul>
				);
			}

			return (
				<p key={i}>
					{lines.map((line, j) => (
						<Fragment key={j}>
							{renderInline(line)}
							{j < lines.length - 1 && <br />}
						</Fragment>
					))}
				</p>
			);
		});
}

export default function AskAssistant() {
	const [question, setQuestion] = useState("");
	const [status, setStatus] = useState<Status>("idle");
	const [result, setResult] = useState<AskResponse | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const inputId = useId();
	// Guards against a slow first request's response landing after a second,
	// faster one — only the most recent request may update the UI.
	const requestIdRef = useRef(0);

	async function ask(text: string) {
		const trimmed = text.trim();
		if (!trimmed || status === "loading") return;

		const requestId = ++requestIdRef.current;
		setStatus("loading");
		setErrorMessage(null);

		try {
			const res = await fetch("/api/ask", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question: trimmed }),
			});
			const body = await res.json().catch(() => null);
			if (requestId !== requestIdRef.current) return;

			if (!res.ok) {
				const message =
					(body && typeof body.error === "string" && body.error) ||
					"Something went wrong answering that question.";
				setStatus("error");
				setErrorMessage(message);
				return;
			}

			setResult(body as AskResponse);
			setStatus("success");
		} catch {
			if (requestId !== requestIdRef.current) return;
			setStatus("error");
			setErrorMessage("Couldn't reach the assistant. Check your connection and try again.");
		}
	}

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		void ask(question);
	}

	function handleExampleClick(example: string) {
		setQuestion(example);
		void ask(example);
	}

	const isLoading = status === "loading";

	return (
		<div className="ask">
			<form className="ask-form" onSubmit={handleSubmit}>
				<label htmlFor={inputId} className="ask-label">
					Ask a question
				</label>
				<div className="ask-input-row">
					<input
						id={inputId}
						type="text"
						className="ask-input"
						placeholder="e.g. Why did we choose PostgreSQL?"
						value={question}
						disabled={isLoading}
						onChange={(e) => setQuestion(e.target.value)}
						autoComplete="off"
					/>
					<button type="submit" className="ask-submit" disabled={isLoading || !question.trim()}>
						{isLoading ? "Asking…" : "Ask"}
					</button>
				</div>
				<p className="ask-hint">Answers are grounded in EngiVault's articles, ADRs, and incident reports.</p>
			</form>

			{status === "idle" && (
				<div className="ask-examples">
					<p className="ask-examples-label">Try asking:</p>
					<div className="ask-chip-row">
						{EXAMPLE_QUESTIONS.map((example) => (
							<button
								type="button"
								key={example}
								className="ask-chip"
								onClick={() => handleExampleClick(example)}
							>
								{example}
							</button>
						))}
					</div>
				</div>
			)}

			{status === "loading" && (
				<div className="ask-loading" role="status" aria-live="polite">
					<span className="ask-spinner" aria-hidden="true" />
					<span>Searching the knowledge base…</span>
				</div>
			)}

			{status === "error" && (
				<div className="ask-error" role="alert">
					<p className="ask-error-title">Couldn't get an answer</p>
					<p className="ask-error-description">{errorMessage}</p>
					<button type="button" className="ask-retry" onClick={() => void ask(question)}>
						Try again
					</button>
				</div>
			)}

			{status === "success" && result && (
				<div className="ask-answer" aria-live="polite">
					<p className="ask-answer-label">From the Engineering Knowledge Base</p>
					<div className="ask-answer-text">{renderAnswer(result.answer)}</div>

					<div className="ask-sources">
						<h2 className="ask-sources-title">Sources</h2>
						{result.sources.length === 0 ? (
							<p className="ask-sources-empty">No specific sources were retrieved for this answer.</p>
						) : (
							<ul className="ask-sources-list">
								{result.sources.map((source) => (
									<li className="ask-source" key={`${source.type}:${source.slug}`}>
										<span className="ask-source-type">{TYPE_LABEL[source.type]}</span>
										<span className="ask-source-title">{source.title}</span>
										{source.description && (
											<span className="ask-source-description">{source.description}</span>
										)}
										<a className="ask-source-link" href={source.url}>
											View document →
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
