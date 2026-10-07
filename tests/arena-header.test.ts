import assert from "node:assert/strict";
import test from "node:test";
import { arenaHeaderFixture, arenaNodes, arenaText } from "./helpers/arena-header-fixture.ts";

test("lobby has one quiz title, concise headings, and retains waiting status and player count", () => {
  const view = arenaHeaderFixture({ totalParticipants: 3 });
  const tree = view.render(), text = arenaText(tree);
  assert.equal(text.split("Operating Systems Arena").length - 1, 1);
  assert.equal(arenaText(arenaNodes(tree, (node) => node.type === "h1")[0]), "Operating Systems Arena");
  assert.equal(arenaText(arenaNodes(tree, (node) => node.type === "h2")[0]), "Lobby");
  assert.match(text, /Waiting for teacher to start/);
  assert.match(text, /3 players joined/);
  assert.doesNotMatch(text, /Power Arena Station|Power Arena Lobby/);
});

test("lobby keeps fighter identities, combat instructions and audio control", () => {
  const view = arenaHeaderFixture({ totalParticipants: 2, allParticipants: [
    { studentId: "student", studentName: "QA Student", initials: "QS" },
    { studentId: "rival", studentName: "Rival Student", initials: "RS" },
  ] });
  const text = arenaText(view.render());
  for (const label of ["QA Student (You)", "Rival Student", "Joined Fighters (2)",
    "Score-Based Battle Arsenal (1x Per Match)", "Meteor Strike", "-100 PTS to Rival",
    "Earthquake", "-60 PTS to Rival", "Blizzard Frost", "-40 PTS to Rival",
    "Guardian Shield", "Blocks one incoming attack", "Zero Camera / Mic Requirements"]) {
    assert.ok(text.includes(label), "Missing lobby information: " + label);
  }
  const mute = arenaNodes(view.render(), (node) => node.type === "button" && node.props.title === "Mute Game Audio")[0];
  mute.props.onClick();
  assert.equal(view.values.get("soundEnabled"), false);
  assert.equal(arenaNodes(view.render(), (node) => node.props.title === "Enable Game Audio").length, 1);
  assert.match(view.html(), /aria-label="QA Student identity"/);
});

test("gameplay header retains exact authoritative timer, points, rank, progress and identity", () => {
  const view = arenaHeaderFixture({ phase: "in_wave", matchTimeLeft: 754, score: 235, studentRank: 2, totalParticipants: 12 });
  const header = arenaNodes(view.render(), (node) => node.type === "header")[0];
  const text = arenaText(header);
  assert.match(text, /Question 1 of 1/);
  assert.match(text, /Rank #2 of 12/);
  assert.match(text, /12:34/);
  assert.match(text, /235 PTS/);
  assert.equal(arenaText(arenaNodes(header, (node) => node.type === "h1")[0]), "Operating Systems Arena");
  assert.match(view.html(), /aria-label="QA Student identity"/);
  assert.match(view.html(), /Which component manages hardware\?/);
  arenaNodes(header, (node) => node.type === "button" && node.props.title === "Mute")[0].props.onClick();
  assert.equal(view.values.get("soundEnabled"), false);
});

test("retry and completed states preserve their specific progress labels", () => {
  const retry = arenaHeaderFixture({ phase: "in_wave", questionWork: { nextWork: { kind: "retry", questionId: 1 } } });
  assert.match(arenaText(arenaNodes(retry.render(), (node) => node.type === "header")[0]), /Retry 1 of 1/);
  const completed = arenaHeaderFixture({ phase: "in_wave", questionsCompleted: true });
  assert.match(arenaText(arenaNodes(completed.render(), (node) => node.type === "header")[0]), /Completed \(1\/1\)/);
});

test("spectator heading is concise while status, standings, timer and summary navigation remain", () => {
  const view = arenaHeaderFixture({ phase: "in_wave", questionsCompleted: true, isSpectating: true,
    matchTimeLeft: 95, score: 300, studentRank: 1, totalParticipants: 2 });
  const tree = view.render(), text = arenaText(tree);
  assert.equal(arenaText(arenaNodes(tree, (node) => node.type === "h3")[0]), "Live Standings");
  assert.doesNotMatch(text, /Power Arena Live Spectator Lobby/);
  for (const label of ["Active Match • Spectator View", "In Progress", "1:35 left", "300 PTS",
    "Full Live Leaderboard (2 Players)", "View Summary Card"]) assert.ok(text.includes(label), label);
  arenaNodes(tree, (node) => node.type === "button" && arenaText(node) === "View Summary Card")[0].props.onClick();
  assert.equal(view.values.get("isSpectating"), false);
});

test("summary navigation still opens the spectator lobby and returns to the student dashboard", () => {
  const view = arenaHeaderFixture({ phase: "in_wave", questionsCompleted: true });
  const tree = view.render();
  arenaNodes(tree, (node) => node.props.id === "btn-back-to-arena-lobby")[0].props.onClick();
  assert.equal(view.values.get("isSpectating"), true);
  arenaNodes(tree, (node) => node.type === "button" && arenaText(node) === "Back to Dashboard")[0].props.onClick();
  assert.deepEqual(view.navigation, ["/dashboard/student"]);
});
