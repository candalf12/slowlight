/* slowlight - the eye.
 *
 * It sits behind the boat and a little above her, looking slightly down. It is
 * not bolted on: the heading it trails eases, so a turn shows her flank for a
 * few seconds before she straightens; it rides only half of the swell under it,
 * so the horizon breathes instead of heaving; and the pitch is bounded at both
 * ends, so the viewer never ends up staring at the sky or down through the
 * water. Reduced motion lengthens every one of those easings.
 */
(function (SL) {
  'use strict';
  var clamp = SL.clamp, lerp = SL.lerp, approach = SL.approach;

  var DIST = 17.6, HEIGHT = 4.55, CLEAR = 1.75;
  var PITCH = -0.074, PITCH_MIN = -0.22, PITCH_MAX = 0.03;
  var FOV = 0.88;

  function Camera(world) {
    /* Which quarter it sits on - fixed for a world, so the view never swings
     * round behind her while you are watching. */
    this.bias = world && world.value('camera/side') < 0 ? -1 : 1;
    this.yaw = 0;
    this.pitch = PITCH;
    this.x = 0; this.y = HEIGHT; this.z = 0;
    this.dist = DIST;
    this.fwd = [0, 0, 1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.started = false;
  }

  Camera.prototype.setSize = function (W, H) {
    var aspect = Math.max(0.4, W / Math.max(1, H));
    SL.m4perspective(this.proj, FOV, aspect, 0.6, 12000);
    this.tanY = Math.tan(FOV * 0.5);
    this.tanX = this.tanY * aspect;
  };

  Camera.prototype.follow = function (sea, s, dt) {
    var calm = s.reduced ? 1.9 : 1;

    /* The heading it trails, not the heading she is on this instant - and
     * never quite square behind her. A few degrees of wander is what lets the
     * eye read a hull as a hull rather than as a shape coming at it. */
    var off = this.bias * (0.34 + SL.sfbm(s.t * 0.019, 17.3, 2) * 0.10) *
              (s.reduced ? 0.8 : 1);
    /* Trailing a turn costs the quarter it sits on, and a long turn could give
     * the whole of it away. Give most of that back, and keep the rest as the
     * swing that makes a turn feel like one. */
    off += s.steer * 0.115;
    var d = SL.angleDelta(this.yaw, s.heading + off);
    this.yaw += d * (1 - Math.exp(-dt / (1.05 * calm)));

    /* A touch further back when she is really sailing, so the frame opens up. */
    var wantDist = DIST + clamp(s.course - 1, -0.5, 0.9) * 2.6;
    this.dist = approach(this.dist, wantDist, 2.4, dt);

    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var ex = s.boatX - sy * this.dist;
    var ez = s.boatZ - cy * this.dist;
    if (!this.started) { this.x = ex; this.z = ez; this.started = true; }
    /* Sideways it eases, so the boat swings across the frame in a turn rather
     * than being dragged round with it. */
    this.x = approach(this.x, ex, 0.30 * calm, dt);
    this.z = approach(this.z, ez, 0.30 * calm, dt);

    /* It rides half the swell under it: enough to feel the water, not enough
     * to make anyone seasick. */
    var here = sea.heightAt(this.x, this.z, s.t);
    var wantY = here * (s.reduced ? 0.25 : 0.5) + s.boatY * 0.22 + HEIGHT;
    this.y = approach(this.y, wantY, 0.75 * calm, dt);
    if (this.y < here + CLEAR) this.y = here + CLEAR;

    /* The viewer's own vantage breathes a little. */
    var breath = (Math.sin(s.t * 0.11) * 0.0055 + Math.sin(s.t * 0.047 + 2.1) * 0.0035) * s.motion;
    this.pitch = clamp(PITCH + breath, PITCH_MIN, PITCH_MAX);
    var roll = (Math.sin(s.t * 0.074 + 1.3) * 0.006 + s.boatRoll * 0.10) * s.motion;

    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var f = this.fwd, r = this.right, u = this.up;
    f[0] = cp * sy; f[1] = sp; f[2] = cp * cy;
    r[0] = cy; r[1] = 0; r[2] = -sy;
    u[0] = -sp * sy; u[1] = cp; u[2] = -sp * cy;
    if (roll) {
      var cr = Math.cos(roll), sr = Math.sin(roll);
      var ux = u[0] * cr + r[0] * sr, uy = u[1] * cr + r[1] * sr, uz = u[2] * cr + r[2] * sr;
      var rx = r[0] * cr - u[0] * sr, ry = r[1] * cr - u[1] * sr, rz = r[2] * cr - u[2] * sr;
      u[0] = ux; u[1] = uy; u[2] = uz;
      r[0] = rx; r[1] = ry; r[2] = rz;
    }

    SL.m4lookAt(this.view, this.x, this.y, this.z,
                this.x + f[0], this.y + f[1], this.z + f[2], u[0], u[1], u[2]);
    SL.m4mul(this.viewProj, this.proj, this.view);
  };

  /* Put the camera straight behind the boat, for the first frame. */
  Camera.prototype.snap = function (sea, s) {
    this.yaw = s.heading;
    this.started = false;
    this.dist = DIST;
    this.follow(sea, s, 1e6);
  };

  Camera.prototype.shift = function (dx, dz) {
    this.x += dx;
    this.z += dz;
  };

  SL.Camera = Camera;
})(window.SL);
