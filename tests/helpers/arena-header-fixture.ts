import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { loadArenaModule } from "./arena-fixture.ts";
import * as identity from "../../src/lib/student-identity.ts";

const file = "src/app/arena/[id]/content.tsx";
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "ArenaContent")!;
const stateNames = component.body!.statements.flatMap((statement) =>
  ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap((declaration) =>
    ts.isArrayBindingPattern(declaration.name) && declaration.initializer &&
    ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === "useState"
      ? [declaration.name.elements[0].getText(source)] : []) : []);
const ArenaIdentity = loadArenaModule("src/components/arena/arena-identity.tsx", {
  "react/jsx-runtime": jsxRuntime, "lucide-react": icons, "@/lib/student-identity": identity,
}).ArenaIdentity;

// Render the actual Arena view with named state fixtures. Effects, network and
// combat children are isolated; no server, database, camera or match is started.
export function arenaHeaderFixture(state: Record<string, any> = {}, props: Record<string, any> = {}) {
  const values = new Map<string, any>(Object.entries(state)), navigation: string[] = [];
  let index = 0;
  const react = { ...React, useEffect() {}, useCallback: (callback: any) => callback,
    useRef: (current: any) => ({ current }),
    useState: (initial: any) => {
      const name = stateNames[index++];
      if (!name) throw new Error("Unexpected Arena state hook");
      if (!values.has(name)) values.set(name, typeof initial === "function" ? initial() : initial);
      return [values.get(name), (next: any) => values.set(name, typeof next === "function" ? next(values.get(name)) : next)];
    },
  };
  const Arena = loadArenaModule(file, {
    react, "react/jsx-runtime": jsxRuntime, "lucide-react": icons,
    "@/components/assessment-theme-control": { __esModule: true, default: () => jsxRuntime.jsx("button", { type: "button", children: "Theme" }) },
    "next/navigation": { useRouter: () => ({ push: (url: string) => navigation.push(url) }) },
    "pusher-js": { __esModule: true, default: class {} },
    "@/lib/arena-feedback": {}, "@/lib/arena-client-reconciliation": {}, "@/lib/student-battle": {},
    "@/lib/student-identity": identity, "@/components/arena/arena-identity": { ArenaIdentity },
    "@/components/arena/arena-effects": { ArenaEffects: () => null },
    "@/components/arena/arena-battle-dock": { ArenaBattleDock: () => null },
    "@/components/arena/arena-podium": { ArenaPodium: () => null },
  }).ArenaContent;
  const render = () => {
    index = 0;
    return Arena({
      quizId: 77, quizTitle: "Operating Systems Arena", subjectName: "Computer Science", teacherId: "teacher",
      studentId: "student", studentName: "QA Student", studentQuizId: "attempt",
      initialQuizStatus: "active", initialStudentStatus: "enrolled", savedAnswers: [],
      questions: [{ id: 1, questionText: "Which component manages hardware?", points: 100,
        choices: [{ id: 1, choiceText: "Operating system" }, { id: 2, choiceText: "Web page" }] }],
      ...props,
    });
  };
  return { render, html: () => renderToStaticMarkup(render()), navigation, values };
}
export function arenaNodes(value: any, predicate: (node: React.ReactElement<any>) => boolean): React.ReactElement<any>[] {
  if (Array.isArray(value)) return value.flatMap((child) => arenaNodes(child, predicate));
  if (!React.isValidElement<any>(value)) return [];
  return [...(predicate(value) ? [value] : []), ...arenaNodes(value.props.children, predicate)];
}
export function arenaText(value: any): string {
  if (Array.isArray(value)) return value.map(arenaText).join("");
  return React.isValidElement<any>(value) ? arenaText(value.props.children)
    : value == null || typeof value === "boolean" ? "" : String(value);
}
