# Xibo Open-Source Signage & Dynamic Slide Duration Guide

---

## 1. Overview of Xibo Digital Signage

Xibo is an open-source digital signage platform designed to schedule and push visual content (videos, images, web pages, weather feeds, layout regions) to remote displays over a local network or the internet.

### Architecture

1. **Xibo CMS (Content Management System)**
   * **Licensing:** 100% Free & Open Source (**AGPLv3**).
   * **Tech Stack:** PHP / MariaDB (MySQL).
   * **Deployment:** Best deployed using official Docker containers (`docker-compose`).
2. **Xibo Players (Display Clients)**
   * **Open-Source Players:** Windows and Linux client applications are free and open-source.
   * **Commercial Players:** Android, Tizen (Samsung), webOS (LG), and macOS clients require commercial licenses from Xibo Signage Ltd.

---

## 2. Dynamic Slide / Item Duration Overview

Xibo handles dynamic timing through several mechanisms depending on the media or widget type:

| Content Type | How Duration is Handled |
| :--- | :--- |
| **Video / Audio** | Fully Dynamic (automatically plays for the full runtime of the media file). |
| **Images / Fixed Media** | Set per item in the Layout/Playlist timeline editor. |
| **Web Pages / Embedded HTML** | Set manually OR signaled dynamically using the JavaScript Embedded API (`XiboPageRendered`). |
| **DataSets / RSS Tickers** | Scales based on row counts, scroll speed, or refresh rates. |
| **API / Webhooks** | Remote triggers/interrupts sent over XMR (Xibo Message Relay) to change layouts live. |

---

## 3. How to Notify Xibo from Custom HTML / Web Pages

To allow a web page to dynamically inform Xibo when it finishes loading, processing, or animating:

### Step 1: CMS Configuration
1. Open the **Webpage** or **Embedded Content** widget in the Layout/Playlist Editor.
2. Enable **Use Duration from Page** (or **Page Finish Signal**).
3. Set a safe fallback duration (e.g., `10` seconds) in case of script failure.

### Step 2: Client JavaScript Code
Include a completion check within your page's JavaScript execution:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Dynamic Xibo Display</title>
</head>
<body>
  <div id="content">Loading dynamic data...</div>

  <script>
    async function loadData() {
      try {
        const response = await fetch('https://api.example.com/data');
        const data = await response.json();
        document.getElementById('content').innerText = data.message;
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        notifyXibo();
      }
    }

    function notifyXibo() {
      if (typeof XiboPageRendered === 'function') {
        XiboPageRendered();
      } else if (window.xibo && typeof window.xibo.pageRendered === 'function') {
        window.xibo.pageRendered();
      } else {
        console.log('Not running inside a Xibo player environment.');
      }
    }

    window.addEventListener('DOMContentLoaded', loadData);
  </script>
</body>
</html>
```

---

## 4. Version Support & Compatibility Matrix

| Feature | Supported Xibo Versions | Notes / Requirements |
| :--- | :--- | :--- |
| **Video Auto-Duration** | **v1.7+** | Core player functionality. |
| **`XiboPageRendered()` / JS Signal** | **v1.8.0+** *(Stabilized in **v2 / v3**)* | Requires matching player & CMS capabilities. |
| **Local Webview JavaScript API** | **v3.0+ & v4.0+** | Modern JS API injected into player webviews. |
| **XMR Webhook Interrupts** | **v1.8.0+** | Requires XMR service configured on port 9505. |

### Important Troubleshooting Notes
* **Player / CMS Mismatch:** Ensure display player applications are updated to match or stay close to your CMS major version.
* **Headers:** Cross-origin web content blocking (`X-Frame-Options`) must allow framing, or the widget must be set to **Open Natively**.