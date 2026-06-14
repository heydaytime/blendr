import Image from "next/image";

export default function Home() {
  return (
    <main className="landing">
      {/* Subtle radial glow behind logo */}
      <div className="landing-glow" />

      <div className="landing-content">
        {/* Logo */}
        <div className="landing-logo">
          <Image
            src="/blendr-favicon.svg"
            alt="Blendr"
            width={96}
            height={96}
            style={{ borderRadius: 24 }}
            priority
          />
        </div>

        {/* Headline */}
        <h1 className="landing-headline">Blendr</h1>

        {/* Subheadline */}
        <p className="landing-subheadline">
          Watch YouTube together.
          <br />
          Perfect sync. Zero screenshare.
        </p>

        {/* CTA */}
        <a
          href="https://chromewebstore.google.com/detail/blendr-sync-youtube-and-t/dhijdnhjdpoiegbagdcjgaokoljgdbno"
          target="_blank"
          rel="noopener noreferrer"
          className="landing-cta"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          Get the Extension
        </a>

        {/* Secondary text */}
        <p className="landing-meta">Free &middot; Chrome Extension</p>
      </div>

      {/* Bottom tagline */}
      <div className="landing-footer">
        <p>No session link? Ask the admin for one.</p>
        <div className="landing-links">
          <a href="mailto:support@blendr.live">Support</a>
          <span>&middot;</span>
          <a href="/privacy-policy">Privacy Policy</a>
        </div>
      </div>
    </main>
  );
}
