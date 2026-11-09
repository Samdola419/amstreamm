const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const playerSource = fs.readFileSync(path.join(__dirname, '..', 'assets/js/player.js'), 'utf8');
const start = playerSource.indexOf('function parsePlayerMessage(raw) {');
const end = playerSource.indexOf("\nwindow.addEventListener('message'", start);
assert(start >= 0 && end > start, 'Could not locate parsePlayerMessage()');
const parserSource = playerSource.slice(start, end) + '\nthis.parsePlayerMessage = parsePlayerMessage;';
const sandbox = {};
vm.runInNewContext(parserSource, sandbox);
const parse = sandbox.parsePlayerMessage;

const cases = [
  ['plain pause event', { event: 'pause' }, 'pause'],
  ['paused event', { event: 'paused' }, 'pause'],
  ['provider onPause event', { event: 'onPause', data: { currentTime: 91.2 } }, 'pause'],
  ['nested player state', { type: 'PLAYER_EVENT', data: { state: 'PAUSED', currentTime: 32 } }, 'pause'],
  ['string-valued nested state', { type: 'PLAYER_EVENT', data: 'PAUSED' }, 'pause'],
  ['numeric provider state in info', { type: 'playerStateChanged', info: 2 }, 'pause'],
  ['numeric state change (paused)', { type: 'STATE_CHANGE', data: 2 }, 'pause'],
  ['numeric state change (playing)', { type: 'STATE_CHANGE', data: 1 }, 'play'],
  ['boolean paused state', { type: 'player', data: { isPaused: true } }, 'pause'],
  ['boolean playing state', { type: 'player', data: { isPlaying: true } }, 'play'],
  ['string pause event', 'paused', 'pause'],
  ['string play event', 'play', 'play'],
  ['seek event', { event: 'seeked', data: { currentTime: 54 } }, 'seek'],
  ['time update', { event: 'timeupdate', data: { time: 10, duration: 100 } }, 'time']
];

for (const [name, payload, expected] of cases) {
  const actual = parse(payload);
  assert.equal(actual?.kind, expected, `${name}: expected ${expected}, got ${JSON.stringify(actual)}`);
  console.log(`PASS ${name}`);
}

const roomsSource = fs.readFileSync(path.join(__dirname, '..', 'assets/js/rooms.js'), 'utf8');
assert.match(roomsSource, /const ROOM_HOST_STALL_MS = 2800/);
assert.match(roomsSource, /const ROOM_HOST_STATIONARY_TICKS = 2/);
assert.match(roomsSource, /roomSignAndBroadcast\(packet\)/);
assert.match(roomsSource, /if \(activeRoom && roomIsHost\(\)\) roomSendHostControl\(message\.kind, roomLastPosition\)/);
assert.match(roomsSource, /function roomApplyPauseToPlayer\(position, expectedSequence = roomLastHostSequence\)/);
assert.match(roomsSource, /applyRoomPlayerCommand\('pause', target\)/);
console.log('PASS immediate host pause broadcast and guest pause reassertion hooks');
console.log(`PASS ${cases.length + 1} pause-sync checks`);

// The host pause event must immediately enter the signed Realtime control path.
function extractFunction(source, name, nextMarker) {
  const from = source.indexOf(`function ${name}(`);
  const to = source.indexOf(nextMarker, from);
  assert(from >= 0 && to > from, `Could not extract ${name}()`);
  return source.slice(from, to);
}

const hostCalls = [];
const hostHarness = `
let roomLastPosition = 90;
let roomPlayerIsPlaying = true;
let roomLastPlayerTickAt = 0;
let roomLastPlaybackAdvanceAt = 0;
let roomExplicitPauseAt = 0;
let roomStationaryHostTicks = 0;
let roomLastStationaryHostTickAt = 0;
let activeRoom = { me: { role: 'host' } };
let accountUser = null;
const Date = { now: () => 5000 };
function roomIsHost() { return true; }
function roomSendHostControl(kind, position) { hostCalls.push({ kind, position }); roomPlayerIsPlaying = kind === 'play'; }
function roomClearHostPauseTimer() {}
function roomArmHostPauseTimer() {}
function roomBroadcastHostState() {}
${extractFunction(roomsSource, 'roomOnPlayerMessage', '\nfunction roomOnPlayerLoaded')}
roomOnPlayerMessage({ kind: 'pause', time: 91.25 });
({ hostCalls, roomPlayerIsPlaying, roomLastPosition, roomExplicitPauseAt });
`;
const hostResult = vm.runInNewContext(hostHarness, { hostCalls });
assert.equal(hostResult.hostCalls.length, 1, 'Pause should be sent immediately once');
assert.equal(hostResult.hostCalls[0].kind, 'pause');
assert.equal(hostResult.hostCalls[0].position, 91.25);
assert.equal(hostResult.roomPlayerIsPlaying, false);
console.log('PASS host pause event is published immediately at the event timestamp');

// Providers that omit explicit Pause events are detected from stationary time updates.
const stationaryCalls = [];
const stationaryHarness = `
let now = 5000;
let roomLastPosition = 91.0;
let roomPlayerIsPlaying = true;
let roomLastPlayerTickAt = 0;
let roomLastPlaybackAdvanceAt = 3500;
let roomExplicitPauseAt = 0;
let roomStationaryHostTicks = 0;
let roomLastStationaryHostTickAt = 0;
const ROOM_HOST_STATIONARY_TICKS = 2;
let activeRoom = { me: { role: 'host' } };
let accountUser = null;
const Date = { now: () => now };
function roomIsHost() { return true; }
function roomSendHostControl(kind, position) { stationaryCalls.push({ kind, position }); roomPlayerIsPlaying = kind === 'play'; }
function roomClearHostPauseTimer() {}
function roomArmHostPauseTimer() {}
function roomBroadcastHostState() {}
${extractFunction(roomsSource, 'roomOnPlayerMessage', '\nfunction roomOnPlayerLoaded')}
roomOnPlayerMessage({ kind: 'time', time: 91.0 });
now = 5400;
roomOnPlayerMessage({ kind: 'time', time: 91.0 });
({ stationaryCalls, roomPlayerIsPlaying, roomStationaryHostTicks });
`;
const stationaryResult = vm.runInNewContext(stationaryHarness, { stationaryCalls });
assert.equal(stationaryResult.stationaryCalls.length, 1);
assert.equal(stationaryResult.stationaryCalls[0].kind, 'pause');
assert.equal(stationaryResult.roomPlayerIsPlaying, false);
console.log('PASS providers without pause events are detected from stationary time updates');

// Guest command ordering: pause immediately, then seek and re-pause after provider settles.
const guestCommands = [];
let delayedPause = null;
const pauseHelper = extractFunction(roomsSource, 'roomApplyPauseToPlayer', '\nfunction roomSetLocalVolume');
const guestHarness = `
let activeRoom = { room: { id: 'room-test' }, me: { role: 'member' } };
let roomPlayerIsPlaying = true;
let roomLastPosition = 0;
let roomLastPlayerTickAt = 0;
let roomLastGuestPauseCommandAt = 0;
let roomLastHostSequence = 42;
function roomIsHost() { return false;}
function applyRoomPlayerCommand(action, position) { guestCommands.push({ action, position }); }
${pauseHelper}
roomApplyPauseToPlayer(91.25);
`;
vm.runInNewContext(guestHarness, { guestCommands, setTimeout: callback => { delayedPause = callback; return 1; }, Date: { now: () => 9000 } });
assert.deepEqual(guestCommands.map(x => x.action), ['pause']);
assert.equal(typeof delayedPause, 'function');
delayedPause();
assert.deepEqual(guestCommands.map(x => x.action), ['pause', 'seek', 'pause']);
assert.deepEqual(guestCommands.map(x => x.position), [91.25, 91.25, 91.25]);
console.log('PASS guest pause is applied immediately and reasserted after final-position seek');

// A delayed pause must not override a newer Play event.
const supersededCommands = [];
let supersededTimer = null;
const supersededHarness = `
let activeRoom = { room: { id: 'room-test' }, me: { role: 'member' } };
let roomPlayerIsPlaying = true;
let roomLastPosition = 0;
let roomLastPlayerTickAt = 0;
let roomLastGuestPauseCommandAt = 0;
let roomLastHostSequence = 42;
function roomIsHost() { return false; }
function applyRoomPlayerCommand(action, position) { supersededCommands.push({ action, position }); }
${pauseHelper}
roomApplyPauseToPlayer(91.25, 42);
roomLastHostSequence = 43; // a newer host Play packet arrived before the delayed callback
`;
vm.runInNewContext(supersededHarness, { supersededCommands, setTimeout: callback => { supersededTimer = callback; return 1; }, Date: { now: () => 9000 } });
supersededTimer();
assert.deepEqual(supersededCommands.map(x => x.action), ['pause']);
console.log('PASS stale delayed pause cannot override a newer host playback sequence');
