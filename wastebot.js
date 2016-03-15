var ical = require('ical')
var util = require('util')
var https = require('https')
var fs = require('fs')

var secureConfig = require('./secure')
var baseURL = 'https://api.telegram.org/bot' + secureConfig.botKey + '/'
var updateID = 0
var users = {}
var hoursPrev = 8
var appointments = []

// startup: read events
var eventData = ical.parseFile('config/calendar.ics')
for (var i in eventData) {
  var entry = {}
  entry.name = eventData[i].summary
  entry.start = eventData[i].start
  entry.todo = true
  entry.reminderXh = hoursPrev
  appointments.push(entry)
}
appointments.sort(function (a, b) {
  return a.start - b.start
})

// startup: read users
fs.readFile('config/wastebot.users', 'utf8', function (errors, contents) {
  var userList = contents.split('\n')
  for (var u in userList) {
    if (userList[u].length > 2) {
      var newUser = {}
      newUser.name = fs.readFileSync('config/' + userList[u] + '.username')
      users[userList[u]] = newUser
    }
  }
  log(0, 'user list loaded: ')
  for (var u2 in users) {
    log(0, u2)
  }
})

// calender helper
// get events upcomming in the next n days
function getNextEvents (n) {
  var result = []
  var now = new Date()

  for (var i in appointments) {
    var entry = appointments[i]
    if (entry.start > now && entry.start < now.setDate(now.getDate() + n)) {
      result.push(entry)
    }
  }

  return result
}

function printEventList (list) {
  var result = ''
  for (var i in list) {
    if (i > 0) {
      result += '\n'
    }
    result += list[i].start.getFullYear() + '-' + list[i].start.getMonth() + '-' + list[i].start.getDate() + '-' + list[i].name
  }
  return result
}

function query (url, callback) {
  https.get(url, function (res) {
    var body = ''
    res.on('data', function (chunk) { body += chunk })
    res.on('end', function () {
      if (body) {
        var result
        try {
          result = JSON.parse(body)
          if (result.ok) {
            callback(result)
          }
        } catch (err) {
          log(0, url + ' got html:')
          log(0, body)
        }
      } else {
        log(0, url + ' is empty')
      }
    })
  }).on('error', function (e) {
    log(0, 'Got error: ' + e)
    setTimeout(getUpdates(), 2000)
  })
}

function log (chat, line) {
  var date = new Date()
  fs.appendFile('log/' + chat + '.log', date.toISOString() + ' ' + line + '\n', function (err) {
    if (err !== null) {
      console.log('error writing log file: ' + err)
    }
  })
  console.log(date.toISOString() + ' ' + chat + ' ' + line)
}

function sendMessage (id, text) {
  log(id, Math.floor(Date.now() / 1000) + ' wastebot: ' + text)
  var url = baseURL + 'sendMessage?chat_id=' + id + '&text= ' + encodeURIComponent(text)
  query(url, function () { })
}

function sendMessageMarkup (id, text, markup) {
  log(id, Math.floor(Date.now() / 1000) + ' wastebot [' + markup + ']: ' + text)
  var url = baseURL + 'sendMessage?chat_id=' + id + '&text=' + encodeURIComponent(text) + '&reply_markup=' + encodeURIComponent(markup)
  query(url, function () { })
}

// messaging loop
function getUpdates (start) {
  var url = baseURL + 'getUpdates'
  if (start != null) {
    url += '?offset=' + start
  }

  query(url, function (updates) {
    if (updates !== 'error') {
      messagesProcess(updates)
    }

    messagesGenerate()

    // call function again after 2s
    setTimeout(getUpdates(updateID + 1), 2000)
  })
}

function messagesProcess (updates) {
  for (var i in updates.result) {
    var m = updates.result[i]
    if (m.update_id > updateID) {
      updateID = m.update_id
    }

    messageRespond(m.message)
  }
}

// respond to incomming messages
function messageRespond (message) {
  log(message.chat.id, message.date + ' ' + message.from.first_name +
    '(' + message.from.id + ')@' + message.chat.first_name + '(' +
    message.chat.id + '): ' + message.text)

  if (message.text === undefined) {
    log(message.chat.id, util.inspect(message))
    sendMessage(message.chat.id, 'Sorry, I could not understand message.')
  } else if (message.text === '/kalender') {
    sendMessage(message.chat.id, 'Die Termine der nächsten zwei Wochen sind:\n' + printEventList(getNextEvents(14)))
  } else if (message.text === '/start') {
    if (users[message.chat.id]) {
      sendMessage(message.chat.id, 'Du stehst bereits auf der Nutzerliste. Um von der Liste entfernt zu werden sende /stop')
    } else {
      sendMessage(message.chat.id, 'Du wurdest zur Nutzerliste hinzugefügt.')
      fs.appendFile('config/wastebot.users', message.chat.id + '\n', function (err) {
        if (err !== null) {
          console.log('error3:' + err)
        }
      })
      fs.writeFile('config/' + message.chat.id + '.username', message.chat.first_name, function (err) {
        if (err !== null) {
          console.log('error4:' + err)
        }
      })

      users[message.chat.id] = { name: message.chat.first_name }
    }
  } else if (message.text === '/stop') {
    if (users[message.chat.id]) {
      sendMessage(message.chat.id, 'Du wurdest von der Nutzerliste entfernt. Um wieder als Nutzer hinzugefügt zu werden sende /start')
      var usersNew = {}
      for (var a in users) {
        if (a !== message.chat.id) {
          usersNew[a] = users[a]
        }
      }
      users = usersNew

      var userText = ''
      for (var a2 in users) {
        userText += a2 + '\n'
      }

      fs.writeFile('config/wastebot.users', userText, function (err) {
        console.log('error5:' + err)
      })
    } else {
      sendMessage(message.chat.id, 'Du stehst nicht auf der Nutzerliste. Um als Nutzer hinzugefügt zu werden sende /start')
    }
  } else if (message.text === '/test') {
    sendMessageMarkup(message.chat.id, 'Morgen ist ' + appointments[0].name + '. Steht die Mülltonne schon draußen?',
      '{"keyboard": [["Müll steht draußen"], ["Erneut erinnern in 10 Minuten"], ["Erneut erinnern in 2 Stunden"]],"one_time_keyboard": true}'
    )
  } else if (message.text === 'Müll steht draußen' || message.text.toLowerCase() === 'ja') {
    var openAppointments = false
    var now = new Date()
    var future = new Date()
    future.setHours(now.getHours() + hoursPrev)

    for (var a in appointments) {
      if (appointments[a].todo && appointments[a].start > now && appointments[a].start < future) {
        openAppointments = true
      }
    }
    if (openAppointments) {
      sendMessage(message.chat.id, 'Sehr gut, vielen Dank.')

      for (var a in appointments) {
        if (appointments[a].start > now && appointments[a].start < future) {
          appointments[a].todo = false
        }
      }

      for (var u in users) {
        if (u !== message.chat.id) {
          sendMessage(u, users[message.chat.id].name + ' hat den Müll rausgestellt!')
        }
      }
    } else {
      sendMessage(message.chat.id, 'Derzeit stehen keine Termine an.')
    }
  } else if (message.text.indexOf('Erneut erinnern in') === 0 || message.text.toLowerCase() === 'nein') {
    var openAppointments = false
    var now = new Date()
    var future = new Date()
    future.setHours(now.getHours() + hoursPrev)
    for (var a in appointments) {
      if (appointments[a].todo && appointments[a].start > now && appointments[a].start < future) {
        openAppointments = true
      }
    }
    if (openAppointments) {
      sendMessage(message.chat.id, 'Okay, ich erinnere dich erneut in einer Stunde.')
    } else {
      sendMessage(message.chat.id, 'Derzeit stehen keine Termine an.')
    }
  } else {
    sendMessage(message.chat.id, 'Sorry, I could not understand message: ' + message.text)
  }
}

// send outgoing messages
function messagesGenerate () {
  // get appointments less then 6 hours in the future
  var now = new Date()
  var future = new Date()
  future.setHours(now.getHours() + hoursPrev)

  for (var a in appointments) {
    if (appointments[a].todo && appointments[a].start > now && appointments[a].start < future) {
      if (appointments[a].reminderXh > ((appointments[a].start - now) / 3600000)) {
        appointments[a].reminderXh--

        for (var i in users) {
          log(0, 'sending reminder to user ' + i + ' about ' + appointments[a].name)
          sendMessageMarkup(i, 'Morgen ist ' + appointments[a].name + '. Steht die Mülltonne schon draußen?',
            '{"keyboard": [["Müll steht draußen"], ["Erneut erinnern in einer Stunde"]],"one_time_keyboard": true}')
        }
      }
    }
  }
}

getUpdates()
