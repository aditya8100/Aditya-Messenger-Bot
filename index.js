'use strict';

require('dotenv').config({path: __dirname + '/.env'})
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express().use(bodyParser.json());
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN
const apiaiApp = require('apiai')(process.env.APIAI_KEY);
const moment = require('moment');
let sender_psid;

app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));

app.post('/webhook', (req, res) => {
    let body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(function(entry) {
            let webhookEvent = entry.messaging[0];
            console.log(webhookEvent)

            sender_psid = webhookEvent.sender.id;
            console.log('Sender PSID: ' + sender_psid);

            if (webhookEvent.message) {
                handleMessage(sender_psid, webhookEvent.message);
            } else if (webhookEvent.postback){
                handlePostback(sender_psid, webhookEvent.postback);
            }
        });

        res.status(200).send('Event received!');
    } else {
        res.sendStatus(404)
    }
});

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

app.post("/ai", (req, res) => {
    let response;
    if (req.body.result.action === 'weather' && req.body.result.parameters['date'].length == 0) {
        let city = req.body.result.parameters['geo-city']
        city = city.toString().replace(' ', '+')
        let restUrl = 'https://api.openweathermap.org/data/2.5/weather?APPID=' + process.env.WEATHER_APP_TOKEN + '&q=' + city;
        console.log("URL: " + restUrl)
        request.get(restUrl, (err, res, body) => {
            let data = JSON.parse(body);
            if (!err && res.statusCode == 200) {
                let description = capitalizeFirstLetter(data.weather[0].description);
                let msg = description + ' and the temperature is ' + (Math.round( (data.main.temp - 273) * 10) / 10)  + " degrees celsius.";
                response = {
                    "text": msg
                };
            } else {
                console.log("Error: " + err)
                response = {
                    "text": "Sorry, I couldn't details for this location."
                }
            }

            callSendAPI(sender_psid, response);
        });
    } else if (req.body.result.action === 'weather' && req.body.result.parameters.date.length != 0) {
        let city = req.body.result.parameters['geo-city'];
        let date = req.body.result.parameters['date'];
        // let objects = req.body.result.parameters.any[0];
        city = city.toString().replace(' ', '+');
        let latitude;
        let longitude;
        let msg;
        let restUrlForCoordinates = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + city + '&key=' + process.env.GOOGLE_MAPS_APP_KEY;

        request.get(restUrlForCoordinates, (err, res, body) => {
            if (!err && res.statusCode == 200) {
                let data = JSON.parse(body);

                latitude = data.results[0].geometry.location.lat;
                longitude = data.results[0].geometry.location.lng;

                let restUrlForWeather = 'https://api.darksky.net/forecast/334ca9c38f3fb1e6c4440d477629431a/' + latitude + ',' + longitude + '?units=si';
                console.log(restUrlForWeather)
                request.get(restUrlForWeather, (err, res, body) => {
                    if (!err && res.statusCode == 200) {
                        let dataJSON = JSON.parse(body);
        
                        let keys = dataJSON.daily.data;
                        keys.forEach(function (weatherData) {
                            let weatherDateNormal = moment.unix(weatherData.time).format("YYYY-MM-DD");
                            console.log("Weather time: " + weatherDateNormal + " , Given date: " + date);
                            if (weatherDateNormal.toString() == date.toString()) {
                                console.log("Entered if in weather forecast!s")
                                msg = weatherData.summary + ' High of ' + weatherData.temperatureHigh + ' degree celsius and a low of ' + weatherData.temperatureLow + ' degree celsius';
                            }
                        });
                    } else {
                        msg = "Sorry, I couldn't fetch the details for this location."
                        console.log("Error: " + err);
                    }
                    
                    response = {
                        "text": msg
                    }
                    
                    callSendAPI(sender_psid, response);
                });
            } else {
                console.log("Error: " + err);
            }
        });
    } else if (req.body.result.action === 'email') {
        let emailID = req.body.result.parameters.email[0];
        let emailBody = req.body.result.parameters.any[0];
        emailBody = emailBody.replace(" ", "%20");

        let msg = "https://www.google.com";
        let msg1 = "Click the link below to send your email!"
        let response1 = {
            "attachment":{
                "type":"template",
                "payload":{
                  "template_type":"button",
                  "text":"Click below to send the email",
                  "buttons":[
                    {
                      "type":"web_url",
                      "url":msg,
                      "title":"Send Email!"
                    }
                  ]
                }
              }
        };

        callSendAPI(sender_psid, response1);
    }
});

app.get('/webhook', (req, res) => {
    let VERIFY_TOKEN = 'aditya';

    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK Verified!');
            res.status(200).send(challenge);
        }
    } else {
        res.status(403);
    }
});

// Handles messages events
function handleMessage(sender_psid, received_message) {
    let response;
    let text = received_message.text;
    let aiTextReturned;
    let apiai = apiaiApp.textRequest(text, {
        sessionId: 'session'
    });
    
    if (received_message.text) {
        apiai.on('response', (response) => {
            let aiText = response.result.fulfillment.speech;
            console.log('AI Text: ' + aiText);
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {access_token: PAGE_ACCESS_TOKEN},
                method: 'POST',
                json: {
                  recipient: {id: sender_psid},
                  message: {text: aiText}
                }
              }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                } else if (response.body.error) {
                    console.log('Error in handleMessage: ', response.body.error);
                }
              }); 
        });

        apiai.on('error', (error) => {
            console.log(error);
        });

        apiai.end();
        
        return;
    } else if (received_message.attachments) {
        let imageUrl = received_message.attachments[0].payload.url;

        response = {
            "attachment": {
                "type": "template",
                "payload": {
                    "template_type": "generic",
                    "elements": [{
                        "title": "Is this the right picture",
                        "subtitle": "Tap a button to answer!",
                        "image_url": imageUrl,
                        "buttons": [
                            {
                                "type": "postback",
                                "title": "Yes",
                                "payload": "yes"
                            },
                            {
                                "type": "postback",
                                "title": "No",
                                "payload": "no"
                            }
                        ]
                    }]
                }
            }
        };
    }

    callSendAPI(sender_psid, response);
}
    
    // Handles messaging_postbacks events
function handlePostback(sender_psid, received_postback) {
    let response;

    let payload = received_postback.payload;

    if (payload === 'yes') {
        response = {
            "text": "Thank you!"
        }
    } else {
        response = {
            "text": "I'm sorry."
        }
    }

    callSendAPI(sender_psid, response);
}

function callSendAPI(sender_psid, response) {
    let request_body = {
        "recipient": {
            "id": sender_psid
        },
        "message": response
    };

    request({
        "uri": "https://graph.facebook.com/v2.6/me/messages",
        "qs": { "access_token": PAGE_ACCESS_TOKEN },
        "method": "POST",
        "json": request_body
      }, (err, res, body) => {
        if (!err) {
            console.log('message sent! in callsendAPI()');
        } else {
            console.error("Unable to send message:" + err);
        }
    }); 
}