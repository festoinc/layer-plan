import { Clock3 } from "lucide-react";
import { useWorkspace } from "../store/WorkspaceProvider";

function formatTime(time: string): string {
  return new Date(time).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ActivityViewProps {
  onSelectChapter: (id: string) => void;
}

export function ActivityView({ onSelectChapter }: ActivityViewProps) {
  const { state } = useWorkspace();

  return (
    <section className="chapter-editor overview-page">
      <h1>Activity</h1>
      <p className="overview-description">
        Changes to your chapters and success criteria.
      </p>
      {state.events.length ? (
        <ul className="activity-list">
          {state.events.map((event) => {
            const exists = Boolean(
              event.chapterId && state.chapters.byId[event.chapterId],
            );
            return (
              <li key={event.id}>
                <span className="activity-marker" />
                <div>
                  <p>{event.message}</p>
                  {exists && event.chapterId ? (
                    <button onClick={() => onSelectChapter(event.chapterId!)}>
                      {event.chapterName || "Untitled chapter"}
                    </button>
                  ) : (
                    <span className="activity-missing">
                      {event.chapterName || "Untitled chapter"}
                    </span>
                  )}
                </div>
                <time
                  dateTime={event.time}
                  title={new Date(event.time).toLocaleString()}
                >
                  {formatTime(event.time)}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="activity-empty">
          <Clock3 size={25} />
          <h2>No activity yet</h2>
          <p>Create a chapter or edit a checklist to see your changes here.</p>
        </div>
      )}
    </section>
  );
}
