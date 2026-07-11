var searchbarPlugins = require('searchbar/searchbarPlugins.js')
var ontaskSidebar = require('ontask/sidebar.js')

var BALLOON_COLORS = [
  '#e06060', '#e8894a', '#e0b84a', '#6abf6a',
  '#5ba8d9', '#8a7bc4', '#d96ab8', '#f4a0b0'
]

function createBalloons () {
  var container = document.getElementById('ontask-balloons')
  if (!container) {
    return
  }

  var count = 18 + Math.floor(Math.random() * 8)
  var viewportW = window.innerWidth
  var viewportH = window.innerHeight
  var startY = viewportH + 60

  for (var i = 0; i < count; i++) {
    var balloon = document.createElement('div')
    balloon.className = 'ontask-balloon'

    var color = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)]
    var size = 36 + Math.floor(Math.random() * 28)
    var x = 20 + Math.random() * (viewportW - 120)
    var duration = 3.5 + Math.random() * 3
    var delay = Math.random() * 1.8
    var swayX = -40 + Math.random() * 80

    var body = document.createElement('div')
    body.className = 'ontask-balloon-body'
    body.style.width = size + 'px'
    body.style.height = Math.round(size * 1.2) + 'px'
    body.style.background = 'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.3), ' + color + ' 70%)'

    var highlight = document.createElement('div')
    highlight.className = 'ontask-balloon-highlight'

    var knot = document.createElement('div')
    knot.className = 'ontask-balloon-knot'
    knot.style.borderLeftColor = color
    knot.style.borderRightColor = color

    var string = document.createElement('div')
    string.className = 'ontask-balloon-string'

    balloon.appendChild(body)
    body.appendChild(highlight)
    balloon.appendChild(knot)
    balloon.appendChild(string)

    balloon.style.left = x + 'px'
    balloon.style.setProperty('--ontask-balloon-duration', duration + 's')
    balloon.style.setProperty('--ontask-balloon-delay', delay + 's')
    balloon.style.setProperty('--ontask-balloon-sway', swayX + 'px')
    balloon.style.setProperty('--ontask-balloon-start-y', startY + 'px')
    balloon.style.setProperty('--ontask-balloon-end-y', -(120 + Math.random() * 160) + 'px')

    balloon.addEventListener('click', function (e) {
      var b = e.currentTarget
      b.classList.add('ontask-balloon-pop')
      setTimeout(function () {
        if (b.parentNode) {
          b.parentNode.removeChild(b)
        }
      }, 400)
    })

    container.appendChild(balloon)
  }

  setTimeout(function () {
    var remaining = container.querySelectorAll('.ontask-balloon:not(.ontask-balloon-pop)')
    for (var j = 0; j < remaining.length; j++) {
      remaining[j].classList.add('ontask-balloon-fadeout')
    }
    setTimeout(function () {
      container.innerHTML = ''
    }, 2500)
  }, 8000)
}

function trigger () {
  ontaskSidebar.showMotivation('Here you go — you\'ve got this. Keep going, one block at a time.')
  createBalloons()
}

function check (text) {
  return text.trim().toLowerCase() === 'i need some motivation'
}

function initialize () {
  // URL handler intercepts searchbar.openURL calls
  searchbarPlugins.registerURLHandler(function (text) {
    if (check(text)) {
      trigger()
      return true
    }
    return false
  })

  // direct keydown intercept as a reliable fallback
  var input = document.getElementById('tab-editor-input')
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 && check(input.value)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        trigger()
      }
    })
  }
}

module.exports = { initialize }
