/*
 * Remote kill-switch config.
 *
 * statusUrl: the RAW url of your (secret) GitHub gist / file that lists the
 * machines you have suspended for non-payment. Leave it EMPTY to disable the
 * kill-switch entirely (the app then never checks anything — pure offline).
 *
 * The file at statusUrl is a JSON object mapping a suspended machine id to a
 * signature you produce with `node tools/suspend.js IRON-... "passphrase"`:
 *   { "IRON-1234-5678-90AB-CDEF": "<base64 signature>" }
 *
 * Behaviour is FAIL-OPEN: if the url is empty, unreachable, blocked, or the
 * machine simply isn't listed, the system keeps working. It only locks when it
 * successfully fetches this file AND finds this machine listed with a VALID
 * signature. No time limit, no grace countdown.
 */
module.exports = {
  statusUrl: 'https://gist.githubusercontent.com/Acharfnazha/645f28c2cbdf6001171ea7dc4b7c3e1f/raw/status.json'
};
