export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById("main-content");
        if (main) {
          main.focus();
          main.scrollIntoView({ block: "start" });
        }
      }}
    >
      Skip to document
    </a>
  );
}
