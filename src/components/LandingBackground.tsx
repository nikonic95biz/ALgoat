/** Shared marketing-page backdrop (landing + release notes). */
export function LandingPageBackground() {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 120% 70% at 50% -5%, rgba(46,168,255,0.13), transparent 55%), radial-gradient(ellipse 50% 40% at 90% 20%, rgba(46,168,255,0.05), transparent 55%)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.018]"
        aria-hidden
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(0,0,0,0.9), transparent 80%)",
        }}
      />
    </>
  );
}
