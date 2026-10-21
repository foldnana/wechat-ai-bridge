import whaleIdle from "../../assets/whale/idle-front.png";

/** Unmodified community artwork. Attribution and full license are bundled in /licenses. */
export function WhaleCompanion() {
  return (
    <div className="bridge-whale-companion" aria-hidden="true">
      <div className="whale-float">
        <div
          className="whale-sprite"
          style={{ backgroundImage: `url(${whaleIdle})` }}
        />
      </div>
      <span className="whale-bubble" />
      <span className="whale-bubble whale-bubble-late" />
    </div>
  );
}
