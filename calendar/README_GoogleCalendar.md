get google calendar api
1. console.cloud.google.com
https://console.cloud.google.com/apis/api/calendar-json.googleapis.com/
API/Services → Credentials → your OAuth client → Download JSON

2. set audience to external and add verified developer for testing

3. run testing
python -c "import sys; print(sys.executable)"
python /Users/yilinzheng/Documents/EmotiSync/calendar_test.py

documentations: 
Choose Google Calendar API scopes
https://developers.google.com/workspace/calendar/api/auth
Using OAuth 2.0 to Access Google APIs
https://developers.google.com/identity/protocols/oauth2?


help me write this into a readme instruction