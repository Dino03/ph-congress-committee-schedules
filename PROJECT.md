# Philippine Congress Committee Schedules

This project collects, processes, and presents committee hearing schedules from the Philippine
House of Representatives and Senate, offering a centralized and dependable resource for tracking
upcoming congressional hearings. It aims to make legislative schedules easily accessible and
understandable through well-organized calendars, meeting lists, and relevant visualizations.

Key components include data collection scripts that gather and normalize schedule information,
prebuilt data files that serve as the foundation, and a web interface that delivers an intuitive
user experience for browsing and exploring hearings from both chambers. The platform is built with
simplicity and clarity in mind, helping users quickly find the information they need without
unnecessary complexity.

## Key features

- **Interactive calendar:** The [`CalendarView`](src/components/calendar/calendar-view.tsx)
  component supports month-to-month navigation, colors hearings by chamber via
  [`getEventColors`](src/lib/event-colors.ts), and surfaces agenda and venue details in modals
  driven by [`EventDetails`](src/components/calendar/event-details.tsx) and the daily
  [`DayEventsDialog`](src/components/calendar/day-events-dialog.tsx).
- **Meetings browser:** The [`MeetingsBrowser`](src/components/meetings/meetings-browser.tsx)
  provides keyword search, chamber and committee selectors, and date range inputs while splitting
  results into upcoming and past sections for quick scanning.
- **Unified data pipeline:** The build pipeline combines House, Senate, and fixed reference events
  through [`build-static-data.js`](scripts/build-static-data.js) and
  [`load-events.ts`](src/lib/load-events.ts), ensuring the site always serves a consolidated, clean
  dataset.

Looking ahead, the project intends to enhance how schedules are presented and interacted with,
ensuring that the platform remains a valuable reference for legislators, staff, journalists,
researchers, and the general public interested in legislative activities. By maintaining a clean and
approachable codebase, the project encourages active contributions and continuous improvement from
the community.

This resource stands as a reliable, user-friendly tool designed to bridge the access gap to
congressional schedules in the Philippines, supporting transparency and engagement with the
legislative process.
