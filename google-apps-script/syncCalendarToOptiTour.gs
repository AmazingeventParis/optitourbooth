/**
 * Google Apps Script - Sync "(LIR)" events from Google Calendar to OptiTour
 *
 * Setup:
 * 1. Open Google Apps Script (script.google.com)
 * 2. Create a new project
 * 3. Paste this code
 * 4. Set Script Properties (Project Settings > Script Properties):
 *    - API_URL: https://optitourbooth-api.swipego.app/api/pending-points
 *    - API_KEY: (your generated API key)
 *    - CALENDAR_ID: (your Google Calendar ID, or "primary" for default)
 *    - SYNC_DAYS_AHEAD: 30 (number of days ahead to sync)
 * 5. Run syncLIREvents() manually to test
 * 6. Set up a time-driven trigger (every 15 minutes or hourly)
 */

function syncLIREvents() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL');
  const apiKey = props.getProperty('API_KEY');
  const calendarId = props.getProperty('CALENDAR_ID') || 'primary';
  const syncDaysAhead = parseInt(props.getProperty('SYNC_DAYS_AHEAD') || '30', 10);

  if (!apiUrl || !apiKey) {
    Logger.log('ERROR: API_URL and API_KEY must be set in Script Properties');
    return;
  }

  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    Logger.log('ERROR: Calendar not found: ' + calendarId);
    return;
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startDate.getTime() + syncDaysAhead * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(startDate, endDate);
  const lirEvents = events.filter(function(event) {
    return event.getTitle().trim().toUpperCase().startsWith('(LIR)');
  });

  Logger.log('Found ' + lirEvents.length + ' (LIR) events');

  if (lirEvents.length === 0) {
    return;
  }

  var pendingPoints = [];

  lirEvents.forEach(function(event) {
    var title = event.getTitle().trim();
    // Remove "(LIR)" prefix to get client name
    var clientName = title.substring(5).trim();
    if (!clientName) {
      clientName = 'Client inconnu';
    }

    var eventId = event.getId();
    var eventStart = event.getStartTime();
    var eventEnd = event.getEndTime();
    var location = event.getLocation() || '';
    var description = event.getDescription() || '';

    // Format dates as YYYY-MM-DD
    var startDateStr = formatDate(eventStart);
    var endDateStr = formatDate(eventEnd);

    // For all-day events ending at midnight, the end date is actually the next day
    // Adjust: if end time is exactly midnight, subtract one day
    if (event.isAllDayEvent()) {
      var adjustedEnd = new Date(eventEnd.getTime() - 24 * 60 * 60 * 1000);
      endDateStr = formatDate(adjustedEnd);
    }

    // Point 1: Livraison on start date
    pendingPoints.push({
      date: startDateStr,
      clientName: clientName,
      adresse: location,
      type: 'livraison',
      notes: description ? ('Google Calendar: ' + description) : 'Import Google Calendar (LIR)',
      source: 'google_calendar',
      externalId: eventId + '_livraison'
    });

    // Point 2: Ramassage on end date
    pendingPoints.push({
      date: endDateStr,
      clientName: clientName,
      adresse: location,
      type: 'ramassage',
      notes: description ? ('Google Calendar: ' + description) : 'Import Google Calendar (LIR)',
      source: 'google_calendar',
      externalId: eventId + '_ramassage'
    });
  });

  Logger.log('Sending ' + pendingPoints.length + ' pending points to API');

  // Send to OptiTour API
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-Key': apiKey
    },
    payload: JSON.stringify({ points: pendingPoints }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(apiUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    if (responseCode === 200 || responseCode === 201) {
      Logger.log('SUCCESS: ' + responseBody);
    } else {
      Logger.log('ERROR ' + responseCode + ': ' + responseBody);
    }
  } catch (error) {
    Logger.log('FETCH ERROR: ' + error.toString());
  }
}

function formatDate(date) {
  var year = date.getFullYear();
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  var day = ('0' + date.getDate()).slice(-2);
  return year + '-' + month + '-' + day;
}

/**
 * Setup trigger to run every 15 minutes
 */
function createTrigger() {
  // Remove existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncLIREvents') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new trigger
  ScriptApp.newTrigger('syncLIREvents')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger created: syncLIREvents every 15 minutes');
}
