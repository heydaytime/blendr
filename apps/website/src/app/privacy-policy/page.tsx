export const metadata = {
  title: "Privacy Policy — Blendr",
};

export default function PrivacyPolicy() {
  return (
    <main className="privacy-page">
      <div className="privacy-container">
        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: May 6, 2026</p>

        <section>
          <h2>What data we collect</h2>
          <p>
            The Blendr browser extension reads the following information from YouTube pages you visit:
          </p>
          <ul>
            <li>YouTube video ID (e.g., the <code>v=...</code> in the URL)</li>
            <li>Current playback timestamp</li>
            <li>Play / pause state</li>
          </ul>
          <p>
            This data is only collected when you explicitly click <strong>"Start Broadcasting"</strong> in the extension popup.
          </p>
        </section>

        <section>
          <h2>How we use your data</h2>
          <p>
            The collected playback state is transmitted in real-time to the Blendr backend
            (<code>api.blendr.live</code>) so that viewers in your session can stay synchronized with the video you are watching.
          </p>
          <p>
            We do not store video history, browsing habits, or any personal identifiers.
          </p>
        </section>

        <section>
          <h2>Third parties</h2>
          <p>
            We do not share your data with advertisers, analytics providers, or any other third parties.
          </p>
        </section>

        <section>
          <h2>Data retention</h2>
          <p>
            Playback state is ephemeral — it exists only for the duration of your active broadcast session and is discarded immediately when you stop broadcasting or close the tab.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            If you have questions about this privacy policy, reach out at{" "}
            <a href="mailto:support@blendr.live">support@blendr.live</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
