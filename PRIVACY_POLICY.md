# Privacy Policy for Jira AI Helper (Gemini)

**Last updated: May 1, 2026**

This Privacy Policy describes how the "Jira AI Helper (Gemini)" browser extension handles user data. Our primary principle is privacy by design: your sensitive data stays under your control.

## 1. Data Collection and Usage
The Extension functions as a productivity tool and interacts with the following types of data:

*   **Jira Ticket Data:** The extension reads the Summary and Description of the currently active Jira ticket only when the user clicks the "AI Answer" or "Google Templates" buttons. This data is used solely to provide context for AI generation.
*   **User-Provided Notes:** Any notes entered manually in the extension's modal window are used to improve the AI's response and are saved in local history for your future use.
*   **Google Sheets Data:** If configured, the extension reads data from the Google Sheet URL provided by the user to display resolution templates.

## 2. Data Storage
*   **Local Storage:** All configuration data, including your **Gemini API Key**, **Custom Prompts**, **Google Sheets URL**, and **Note History**, is stored locally within your browser using the `chrome.storage.local` API.
*   **No Remote Storage:** We do not operate any external servers. Your data is never transmitted to us or any third party, except as described in the "Third-Party Services" section below.

## 3. Third-Party Services
To provide its core functionality, the Extension communicates with:

*   **Google Gemini API:** When generating a response, the ticket context and your notes are sent to Google’s generative language servers. This process is governed by Google’s AI Privacy Policy.
*   **Google Sheets:** The extension fetches template data directly from Google’s servers using the URL you provide.

## 4. Permissions Justification
*   `storage`: Used to save your settings and history locally on your device.
*   `alarms`: Used for background synchronization of templates from your Google Sheet.
*   `host permissions`: Required to integrate the tool into your specific Jira domain and to fetch data from Google Spreadsheets.

## 5. Security
Your Gemini API Key is stored securely in your browser's internal storage and is only used to authorize requests to the official Google API. We recommend following security best practices and not sharing your API key with anyone.

## 6. Changes to This Policy
We may update this Privacy Policy from time to time. Any changes will be reflected by the "Last updated" date at the top of this page.

## 7. Contact
If you have any questions about this Privacy Policy, you can contact the developer via the GitHub repository: https://github.com/lsdim/Jira-AI
