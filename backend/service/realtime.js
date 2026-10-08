// Real-time layer (Socket.IO), phase 3 contract section 1.
// Stub created by the lead: app.js already calls init(server) after listen. The carpool backend expert
// replaces it with the Socket.IO server (ticket or access-token handshake, user rooms, room authorizers).

/** Attaches the real-time server to the API's HTTP server (no-op until implemented). */
const init = () => {};

/** Sends an event to every socket of a user (no-op until implemented). */
const emitToUser = () => {};

/** Sends an event to every socket in a room, e.g. "trip:<id>" (no-op until implemented). */
const emitToRoom = () => {};

/** Registers who may join rooms with a prefix: authorizer(user, id) => Promise<boolean> (no-op until implemented). */
const registerRoomAuthorizer = () => {};

module.exports = { init, emitToUser, emitToRoom, registerRoomAuthorizer };
