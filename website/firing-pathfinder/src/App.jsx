import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  BellRinging,
  ChatCircleDots,
  CheckCircle,
  CircleHalf,
  Compass,
  Copy,
  CurrencyDollar,
  DropSlash,
  Fire,
  Info,
  Lifebuoy,
  MagnifyingGlassPlus,
  Package,
  PaperPlaneTilt,
  Printer,
  Question,
  Ruler,
  SealCheck,
  ShieldCheck,
  SlidersHorizontal,
  Stack,
  TextAa,
  WarningCircle,
  Wind,
  X,
} from "@phosphor-icons/react";
import {
  demoReducer,
  entryChoices,
  formatReceipt,
  getGuidance,
  getJourneyPresentation,
  getReceipt,
  getScene,
  getSpaceChoicePriceHint,
  heatChoices,
  initialState,
  questionChoices,
  quickFaqAnswers,
  spaceChoices,
  stages,
} from "./demoModel.js";
import { createClientRequestId, submitFiringTicket } from "./submission.js";
import { buildLegalAcceptance, defaultLegalAcceptance } from "./legal.js";
import kilnSpaceFitTest from "./assets/kiln-space-fit-test.webp";
import kilnSpaceSizingBoard from "./assets/kiln-space-sizing-board.webp";
import kilnSpaceKilnCutaway from "./assets/kiln-space-kiln-cutaway.webp";

const entryIcons = {
  dropoff: Package,
  pickup: BellRinging,
  other: ChatCircleDots,
};

const questionIcons = {
  readiness: SealCheck,
  unusual: Lifebuoy,
  unsure: Compass,
};

const heatIcons = {
  low: SealCheck,
  mid: Fire,
  high: Fire,
  custom: ShieldCheck,
  unknown: Question,
};

const spaceSizingFrames = Object.freeze([
  {
    id: "fit",
    image: kilnSpaceFitTest,
    alt: "An artist arranging a full load on a D-shaped half shelf under a 10-inch height bar.",
    title: "Start with one half shelf",
    description: "Imagine all of your work together on one D-shaped shelf.",
    detail: "If the whole group stays inside the curved edge and the tallest piece is under 10 inches, choose 1 half shelf as your closest guess.",
    estimateCue: "Closest guess: 1 half shelf",
  },
  {
    id: "limits",
    image: kilnSpaceSizingBoard,
    alt: "A D-shaped sizing board with a tall vase above the 10-inch bar and a wide platter beyond the curved edge.",
    title: "Check both width and height",
    description: "Over the curved edge or 10 inches tall? Start with two.",
    detail: "If anything crosses the curved edge, it needs another shelf footprint. If anything stands over the 10-inch bar, it also uses the shelf level above it.",
    estimateCue: "Closest guess: at least 2 half shelves",
  },
  {
    id: "kiln",
    image: kilnSpaceKilnCutaway,
    alt: "An open kiln showing a half shelf and a tall vase taking up the shelf layer above it.",
    title: "Tall work uses two shelf levels",
    description: "A tall piece can be narrow and still use the shelf above.",
    detail: "A tall piece may have a small footprint, but we cannot place another shelf directly above work over 10 inches. That is why tall work starts at 2 half shelves.",
    estimateCue: "Closest guess: at least 2 half shelves",
  },
]);

const spaceRuleIcons = {
  stack: Stack,
  glaze: DropSlash,
};

const accessibilityStorageKey = "mf:firingCareA11y";
const defaultDisplayOptions = Object.freeze({
  textSize: "normal",
  contrast: "normal",
  motion: "full",
});

function safeReadDisplayOptions() {
  let stored = null;
  try {
    stored = window.localStorage.getItem(accessibilityStorageKey);
  } catch {
    return { ...defaultDisplayOptions };
  }

  if (!stored) return { ...defaultDisplayOptions };
  try {
    const parsed = JSON.parse(stored);
    return {
      textSize: parsed?.textSize === "large" ? "large" : "normal",
      contrast: parsed?.contrast === "high" ? "high" : "normal",
      motion: parsed?.motion === "reduced" ? "reduced" : "full",
    };
  } catch {
    return { ...defaultDisplayOptions };
  }
}

function applyDisplayOptions(settings) {
  const root = document.documentElement;
  root.dataset.textSize = settings.textSize;
  root.dataset.contrast = settings.contrast;
  root.dataset.motion = settings.motion;
  delete root.dataset.focus;
}

function writeDisplayOptions(settings) {
  try {
    window.localStorage.setItem(accessibilityStorageKey, JSON.stringify(settings));
  } catch {
    // Display options still work for this visit when storage is unavailable.
  }
}

export function applyStoredDisplayOptions() {
  const settings = safeReadDisplayOptions();
  applyDisplayOptions(settings);
  writeDisplayOptions(settings);
  return settings;
}

function DisplayOptionButton({ active, children, icon: Icon, onClick, optionRef }) {
  return (
    <button
      aria-pressed={active}
      className="display-option-button"
      onClick={onClick}
      ref={optionRef}
      type="button"
    >
      <Icon size={20} weight="duotone" aria-hidden="true" />
      <span className="display-option-label">{children}</span>
      <span aria-hidden="true" className="display-option-state">{active ? "On" : "Off"}</span>
    </button>
  );
}

function DisplayOptions({ triggerRef }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(safeReadDisplayOptions);
  const firstOptionRef = useRef(null);
  const hasCustomSetting = Object.entries(defaultDisplayOptions)
    .some(([setting, defaultValue]) => settings[setting] !== defaultValue);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    applyDisplayOptions(settings);
  }, [settings]);

  useEffect(() => {
    // Normalize legacy values to the three options supported across the site.
    writeDisplayOptions(settings);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    firstOptionRef.current?.focus({ preventScroll: true });
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (setting, activeValue, defaultValue) => {
    setSettings((current) => {
      const next = {
        ...current,
        [setting]: current[setting] === activeValue ? defaultValue : activeValue,
      };
      writeDisplayOptions(next);
      return next;
    });
  };

  const reset = () => {
    const next = { ...defaultDisplayOptions };
    setSettings(next);
    writeDisplayOptions(next);
  };

  return (
    <>
      <button
        aria-controls="pathfinder-display-options"
        aria-expanded={open}
        aria-label={open ? "Close display options" : "Open display options"}
        className="display-options-toggle"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title="Display options"
        type="button"
      >
        <SlidersHorizontal size={19} weight="bold" aria-hidden="true" />
        <span>Display options</span>
      </button>
      <section
        aria-labelledby="display-options-title"
        className="display-options-panel"
        hidden={!open}
        id="pathfinder-display-options"
      >
        <header className="display-options-heading">
          <div>
            <p className="micro-label">Optional view preferences</p>
            <h2 id="display-options-title">Display options</h2>
          </div>
          <button aria-label="Dismiss display options" className="display-options-close" onClick={close} type="button">
            <X size={17} weight="bold" aria-hidden="true" />
          </button>
        </header>
        <p className="display-options-intro">Choose what helps. Browser zoom and system accessibility settings still work here.</p>
        <div className="display-options-list" role="group" aria-label="Display and motion preferences">
          <DisplayOptionButton
            active={settings.textSize === "large"}
            icon={TextAa}
            onClick={() => update("textSize", "large", "normal")}
            optionRef={firstOptionRef}
          >
            Larger text
          </DisplayOptionButton>
          <DisplayOptionButton
            active={settings.contrast === "high"}
            icon={CircleHalf}
            onClick={() => update("contrast", "high", "normal")}
          >
            High contrast
          </DisplayOptionButton>
          <DisplayOptionButton
            active={settings.motion === "reduced"}
            icon={Wind}
            onClick={() => update("motion", "reduced", "full")}
          >
            Reduce motion
          </DisplayOptionButton>
        </div>
        <div className="display-options-actions">
          <button className="display-options-reset" disabled={!hasCustomSetting} onClick={reset} type="button">
            <ArrowCounterClockwise size={17} aria-hidden="true" />
            Reset display options
          </button>
          <button className="display-options-done" onClick={close} type="button">Close display options</button>
        </div>
      </section>
    </>
  );
}

function SpaceRule({ type, title, children }) {
  const Icon = spaceRuleIcons[type];
  return (
    <div>
      <Icon className="space-rule-icon" size={34} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

const phaseMeta = {
  orient: { number: "01", eyebrow: "Start here" },
  question: { number: "02", eyebrow: "Quick answers" },
  heat: { number: "02", eyebrow: "Firing range" },
  space: { number: "03", eyebrow: "Kiln space" },
  guidance: { number: "04", eyebrow: "What to do next" },
  receipt: { number: "05", eyebrow: "Final check" },
};

function getPhaseMeta(state) {
  if (state.entryId === "pickup") {
    if (state.phase === "guidance") return { number: "02", eyebrow: "Before you go" };
    if (state.phase === "receipt") return { number: "03", eyebrow: "Pickup plan" };
  }
  if (state.entryId === "other") {
    if (state.phase === "guidance") return { number: "03", eyebrow: "What to do next" };
    if (state.phase === "receipt") return { number: "04", eyebrow: "Request" };
  }
  return phaseMeta[state.phase];
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers expose Clipboard API but deny the permission.
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.append(field);
  field.select();
  const copied = document.execCommand?.("copy") ?? false;
  field.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function acknowledged(label) {
  return `Got it — ${label.replace(/[.!?]+$/u, "")}.`;
}

function ConeHelp({ choice }) {
  const [open, setOpen] = useState(false);
  const tooltipId = `cone-help-${choice.id}`;

  return (
    <span
      className="cone-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-describedby={tooltipId}
        aria-label={`Cone reference for ${choice.label}`}
        className="cone-help-trigger"
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        type="button"
      >
        <Info size={18} weight="bold" aria-hidden="true" />
      </button>
      <span className="cone-tooltip" hidden={!open} id={tooltipId} role="tooltip">
        {choice.coneHelp}
      </span>
    </span>
  );
}

function ChoiceGroup({ legend, hint, choices, icons, value, onChange, onAdvance, hideLegend = false }) {
  const choiceList = Array.isArray(choices) ? choices : Object.values(choices);
  return (
    <fieldset className="choice-group">
      <legend className={hideLegend ? "sr-only" : undefined}>{legend}</legend>
      {hint ? <p className="choice-hint">{hint}</p> : null}
      <div className="choice-stack">
        {choiceList.map((choice) => {
          const Icon = icons[choice.id];
          const selected = value === choice.id;
          return (
            <div
              className="choice-row"
              data-selected={selected || undefined}
              key={choice.id}
              onDoubleClick={(event) => {
                if (event.target.closest(".cone-help")) return;
                event.preventDefault();
                onChange(choice.id);
                onAdvance?.(choice.id);
              }}
            >
              <label className="choice-row-main">
                <input
                  checked={selected}
                  name={legend}
                  onChange={() => onChange(choice.id)}
                  type="radio"
                  value={choice.id}
                />
                <span className="choice-icon" aria-hidden="true">
                  <Icon size={22} weight={selected ? "fill" : "regular"} />
                </span>
                <span className="choice-copy">
                  <strong>{choice.label}</strong>
                  <span>{choice.description}</span>
                </span>
                {onAdvance ? <ArrowRight className="choice-arrow" size={18} aria-hidden="true" /> : null}
              </label>
              {choice.coneHelp ? <ConeHelp choice={choice} /> : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function HelpTopicGroup({ value, onChange, onAdvance }) {
  return (
    <fieldset className="help-topic-group">
      <legend className="sr-only">What can we help with?</legend>
      <div className="help-topic-intro">
        <ChatCircleDots size={24} weight="duotone" aria-hidden="true" />
        <div>
          <strong>Start with a quick answer.</strong>
          <span>Choose a topic. You can send the studio a note afterward only if you still need to.</span>
        </div>
      </div>
      <div className="help-topic-grid">
        {Object.values(questionChoices).map((choice) => {
          const Icon = questionIcons[choice.id];
          const selected = value === choice.id;
          return (
            <label
              className="help-topic-card"
              data-selected={selected || undefined}
              key={choice.id}
              onDoubleClick={(event) => {
                event.preventDefault();
                onChange(choice.id);
                onAdvance(choice.id);
              }}
            >
              <input
                checked={selected}
                name="help-topic"
                onChange={() => onChange(choice.id)}
                type="radio"
                value={choice.id}
              />
              <span className="help-topic-icon" aria-hidden="true">
                <Icon size={25} weight={selected ? "fill" : "duotone"} />
              </span>
              <span className="help-topic-copy">
                <span className="micro-label">{choice.eyebrow}</span>
                <strong>{choice.label}</strong>
                <span>{choice.description}</span>
                <span className="help-topic-action">
                  {choice.action}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <section className="quick-faq" aria-labelledby="quick-faq-title">
        <div className="quick-faq-heading">
          <strong id="quick-faq-title">Quick answers before you send a form.</strong>
          <span>More first-time answers are on the homepage.</span>
        </div>
        <p><a href="/#quick-answers">Read all quick answers</a></p>
        <div className="quick-faq-grid">
          {quickFaqAnswers.map((item) => (
            <article className="quick-faq-answer" key={item.id}>
              <strong>{item.question}</strong>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </fieldset>
  );
}

function SpaceChoiceGroup({ value, heatId, onChange, onAdvance }) {
  const [activeFrameId, setActiveFrameId] = useState(null);
  const dialogRef = useRef(null);
  const exampleTriggerRef = useRef(null);
  const activeFrame = spaceSizingFrames.find((frame) => frame.id === activeFrameId) ?? null;
  const startingFrame = spaceSizingFrames[0];
  const followupFrames = spaceSizingFrames.slice(1);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!activeFrame || !dialog || dialog.open) return;

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, [activeFrame]);

  const handleDialogClose = () => {
    setActiveFrameId(null);
    exampleTriggerRef.current?.focus({ preventScroll: true });
  };

  const closeExample = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      handleDialogClose();
    }
  };

  return (
    <div className="space-estimator">
      <section className="space-sizing-guide" aria-labelledby="space-sizing-title">
        <header className="space-sizing-header">
          <h3 className="micro-label" id="space-sizing-title">
            Start with one half shelf
          </h3>
          <p className="space-sizing-reassurance">
            <strong>This is a heads-up, not a bill.</strong> Put your work together in the half-shelf shape below,
            then choose the closest fit. We check and adjust it at dropoff.
          </p>
        </header>
        <button
          aria-controls="space-example-dialog"
          aria-haspopup="dialog"
          aria-label={`Open example: ${startingFrame.title}`}
          className="space-sizing-default"
          onClick={(event) => {
            exampleTriggerRef.current = event.currentTarget;
            setActiveFrameId(startingFrame.id);
          }}
          type="button"
        >
          <img alt={startingFrame.alt} decoding="async" loading="eager" src={startingFrame.image} />
          <span className="space-sizing-default-copy">
            <strong>One half shelf is about this much.</strong>
            <span>Gather the whole group inside this D-shaped outline. If it all fits and stays under 10 inches tall, choose 1 half shelf.</span>
            <span className="space-sizing-default-action"><MagnifyingGlassPlus size={13} weight="bold" /> Open the close-up</span>
          </span>
        </button>
        <div className="space-sizing-story" role="group" aria-label="More kiln-space examples">
          {followupFrames.map((frame) => (
            <button
              aria-controls="space-example-dialog"
              aria-haspopup="dialog"
              aria-label={`Open example: ${frame.title}`}
              className="space-sizing-frame"
              key={frame.id}
              onClick={(event) => {
                exampleTriggerRef.current = event.currentTarget;
                setActiveFrameId(frame.id);
              }}
              type="button"
            >
              <img alt={frame.alt} decoding="async" loading="eager" src={frame.image} />
              <span className="space-sizing-caption">
                <strong>{frame.title}</strong>
                <span>{frame.description}</span>
              </span>
              <span className="space-sizing-expand" aria-hidden="true">
                <MagnifyingGlassPlus size={13} weight="bold" />
                Open
              </span>
            </button>
          ))}
        </div>
      </section>

      {activeFrame ? (
        <dialog
          aria-labelledby={`space-example-${activeFrame.id}-title`}
          className="space-example-dialog"
          id="space-example-dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeExample();
          }}
          onClose={handleDialogClose}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeExample();
          }}
          ref={dialogRef}
        >
          <div className="space-example-layout">
            <div className="space-example-media">
              <img alt={activeFrame.alt} decoding="async" src={activeFrame.image} />
            </div>
            <div className="space-example-copy">
              <button autoFocus className="space-example-close" onClick={closeExample} type="button">
                <X size={16} weight="bold" aria-hidden="true" />
                Close
              </button>
              <p className="micro-label">
                Example {spaceSizingFrames.findIndex((frame) => frame.id === activeFrame.id) + 1} of {spaceSizingFrames.length}
              </p>
              <h2 id={`space-example-${activeFrame.id}-title`}>{activeFrame.title}</h2>
              <p className="space-example-detail">{activeFrame.detail}</p>
              <div className="space-example-cue">
                <strong>{activeFrame.estimateCue}</strong>
                <span>A close guess is enough. You do not need to arrange or measure everything perfectly.</span>
              </div>
              <p className="space-example-note">
                This picture is only for planning. The studio team will check the actual fit and fix anything that is off.
              </p>
            </div>
          </div>
        </dialog>
      ) : null}

      <fieldset className="choice-group space-choice-group">
        <legend className="sr-only">Which half-shelf count is closest to the space your work needs?</legend>
        <p className="choice-hint">Pick whatever looks closest. You’re not locking in a price.</p>
        <div className="space-choice-grid">
          {Object.values(spaceChoices).map((choice) => {
            const selected = value === choice.id;
            const priceHint = getSpaceChoicePriceHint(heatId, choice.id);
            return (
              <label
                className="space-choice"
                data-choice-id={choice.id}
                data-selected={selected || undefined}
                key={choice.id}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  onChange(choice.id);
                  onAdvance(choice.id);
                }}
              >
                <input
                  checked={selected}
                  name="kiln-space"
                  onChange={() => onChange(choice.id)}
                  type="radio"
                  value={choice.id}
                />
                <span className="space-choice-copy">
                  <strong>{choice.label}</strong>
                  <span>{choice.description}</span>
                  {priceHint ? (
                    <span className="space-choice-price" data-price-kind={priceHint.kind}>
                      {priceHint.text}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        <section className="space-rules" aria-label="How shelf space is estimated">
          <SpaceRule type="stack" title="Stackable bisque">
            Bisqued plates may stack and share height; glazed surfaces do not.
          </SpaceRule>
          <SpaceRule type="glaze" title="Small glaze runs">
            Advancer shelves help with small runs; clean bottoms still matter.
          </SpaceRule>
        </section>
      </fieldset>
    </div>
  );
}

function Scene({ scene }) {
  const [displayedScene, setDisplayedScene] = useState(() => ({
    ...scene,
    sourceKey: scene.src,
    failed: false,
  }));

  useEffect(() => {
    const alreadyCurrent = displayedScene.sourceKey === scene.src &&
      displayedScene.alt === scene.alt &&
      displayedScene.caption === scene.caption;
    if (alreadyCurrent) return undefined;

    let cancelled = false;
    const image = new Image();
    const commit = () => {
      if (!cancelled) {
        setDisplayedScene({ ...scene, sourceKey: scene.src, failed: false });
      }
    };
    image.onload = commit;
    image.onerror = () => {
      if (!cancelled) {
        setDisplayedScene({ ...scene, sourceKey: scene.src, failed: true });
      }
    };
    image.src = scene.src;
    if (image.complete && image.naturalWidth > 0) {
      commit();
    } else if (typeof image.decode === "function") {
      image.decode().then(commit).catch(() => {
        // onload or onerror remains the source of truth across browser decoders.
      });
    }

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [scene.src, scene.alt, scene.caption, displayedScene]);

  const pending = displayedScene.sourceKey !== scene.src ||
    displayedScene.alt !== scene.alt ||
    displayedScene.caption !== scene.caption;

  return (
    <figure className="scene" aria-busy={pending || undefined} aria-labelledby="scene-caption">
      {displayedScene.failed ? (
        <div className="scene-fallback" role="img" aria-label={displayedScene.alt}>
          Studio image unavailable
        </div>
      ) : (
        <img src={displayedScene.src} alt={displayedScene.alt} />
      )}
      <figcaption id="scene-caption">
        <span className="scene-kicker">From the studio</span>
        <span>{displayedScene.caption}</span>
      </figcaption>
    </figure>
  );
}

function JourneyAtlas({ presentation }) {
  if (presentation.mode === "support") {
    return (
      <section className="journey-atlas journey-atlas--support" aria-labelledby="journey-title">
        <div className="journey-heading journey-heading--support">
          <div>
            <p className="micro-label">Quick help</p>
            <h2 id="journey-title">An answer first. A studio note only if you need one.</h2>
          </div>
          <p className="route-label">{presentation.routeLabel}</p>
        </div>
        <ol className="support-route" aria-label="How quick help works">
          <li><span>1</span><strong>Pick a topic</strong></li>
          <li><span>2</span><strong>Read the answer</strong></li>
          <li><span>3</span><strong>Ask us if needed</strong></li>
        </ol>
      </section>
    );
  }

  const isPickup = presentation.mode === "pickup";
  return (
    <section className="journey-atlas" aria-labelledby="journey-title">
      <div className="journey-heading">
        <div>
          <p className="micro-label">{isPickup ? "You’re at the finish" : "What happens next"}</p>
          <h2 id="journey-title">
            {isPickup ? "The kiln work is done. Pickup is the last step." : "How a firing usually moves through the studio"}
          </h2>
        </div>
        <p className="route-label">{presentation.routeLabel}</p>
      </div>

      <ol className="journey-list">
        {stages.map((stage) => {
          const onRoute = presentation.routeIds.includes(stage.id);
          const focused = presentation.focusStageId === stage.id;
          return (
            <li
              className={`journey-step journey-step--${stage.category}`}
              data-focused={focused || undefined}
              data-on-route={onRoute || undefined}
              key={stage.id}
            >
              <span className="journey-number" aria-hidden="true">{stage.number}</span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      <div
        className="support-branch"
        data-active={presentation.supportActive || undefined}
      >
        <ChatCircleDots size={19} aria-hidden="true" />
        <span>
          <strong>Questions are welcome</strong>
          Use “Ask something else” for material, firing range, size, timing, or studio-access questions.
        </span>
      </div>
    </section>
  );
}

function BackButton({ onClick }) {
  return (
    <button className="text-button" onClick={onClick} type="button">
      <ArrowLeft size={17} aria-hidden="true" />
      Back
    </button>
  );
}

function TicketHeader({ state, titleRef, children }) {
  const meta = getPhaseMeta(state);
  return (
    <header className="ticket-header">
      <div className="ticket-number" aria-hidden="true">{meta.number}</div>
      <div>
        <p className="micro-label">{meta.eyebrow}</p>
        <h2 ref={titleRef} tabIndex="-1">{children}</h2>
      </div>
    </header>
  );
}

function GuidanceActions({ guidance, onBack, onConfirm, onExit }) {
  if (guidance.exitHref || guidance.exitTarget) {
    return (
      <div className="ticket-actions guidance-actions">
        <BackButton onClick={onBack} />
        <div className="guidance-action-set">
          <button className="secondary-button" onClick={onConfirm} type="button">
            <PaperPlaneTilt size={17} aria-hidden="true" />
            {guidance.ctaLabel}
          </button>
          {guidance.exitHref ? (
            <a className="primary-button" href={guidance.exitHref}>
              {guidance.exitLabel}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          ) : (
            <button className="primary-button" onClick={onExit} type="button">
              {guidance.exitLabel}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ticket-actions">
      <BackButton onClick={onBack} />
      <button className="primary-button" onClick={onConfirm} type="button">
        {guidance.ctaLabel}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function PickupGuidance({ guidance, onBack, onConfirm, onExit }) {
  return (
    <div className="guidance guidance--pickup">
      <section className="pickup-ready-card" aria-labelledby="pickup-ready-title">
        <SealCheck size={34} weight="duotone" aria-hidden="true" />
        <div>
          <p className="micro-label" id="pickup-ready-title">{guidance.highlightTitle}</p>
          <strong>{guidance.highlight}</strong>
          <p>{guidance.highlightNote}</p>
        </div>
      </section>

      <section className="pickup-detail-card" aria-labelledby="pickup-detail-title">
        <BellRinging size={27} weight="duotone" aria-hidden="true" />
        <div>
          <h3 id="pickup-detail-title">{guidance.detailTitle}</h3>
          <p>{guidance.detail}</p>
        </div>
      </section>

      <p className="pickup-resend-note">
        <PaperPlaneTilt size={19} aria-hidden="true" />
        {guidance.nextAction}
      </p>

      <GuidanceActions guidance={guidance} onBack={onBack} onConfirm={onConfirm} onExit={onExit} />
    </div>
  );
}

function SupportGuidance({ guidance, onBack, onConfirm, onExit }) {
  return (
    <div className="guidance guidance--support">
      <section className="help-answer" aria-labelledby="help-answer-title">
        <p className="micro-label">{guidance.answerEyebrow}</p>
        <h3 id="help-answer-title">{guidance.answerTitle}</h3>
        <p>{guidance.answer}</p>
      </section>

      <section className="help-followup" aria-labelledby="help-followup-title">
        <ChatCircleDots size={27} weight="duotone" aria-hidden="true" />
        <div>
          <h3 id="help-followup-title">{guidance.followupTitle}</h3>
          <p>{guidance.followup}</p>
        </div>
      </section>

      <section className="help-detail-list" aria-labelledby="help-detail-title">
        <h3 id="help-detail-title">If you write, these details help</h3>
        <ul>
          {guidance.inputs.map((input) => <li key={input}>{input}</li>)}
        </ul>
      </section>

      <GuidanceActions guidance={guidance} onBack={onBack} onConfirm={onConfirm} onExit={onExit} />
    </div>
  );
}

function Guidance({ guidance, onBack, onConfirm, onExit }) {
  if (guidance.variant === "pickup") {
    return <PickupGuidance guidance={guidance} onBack={onBack} onConfirm={onConfirm} onExit={onExit} />;
  }
  if (guidance.variant === "support") {
    return <SupportGuidance guidance={guidance} onBack={onBack} onConfirm={onConfirm} onExit={onExit} />;
  }

  return (
    <div className="guidance">
      <div className="guidance-measures">
        <section className="measure" aria-labelledby="price-title">
          <CurrencyDollar size={23} aria-hidden="true" />
          <div>
            <h3 id="price-title">{guidance.priceLabel}</h3>
            <strong>{guidance.price}</strong>
            <p>{guidance.priceNote}</p>
          </div>
        </section>
        <section className="measure measure--risk" aria-labelledby="risk-title">
          <WarningCircle size={23} aria-hidden="true" />
          <div>
            <h3 id="risk-title">{guidance.riskTitle}</h3>
            <p>{guidance.risk}</p>
          </div>
        </section>
      </div>

      {guidance.billingPolicy ? (
        <section className="billing-policy" aria-labelledby="billing-policy-title">
          <SealCheck size={25} weight="duotone" aria-hidden="true" />
          <div>
            <h3 id="billing-policy-title">{guidance.billingTitle ?? "How billing works"}</h3>
            <p>{guidance.billingPolicy}</p>
          </div>
        </section>
      ) : null}

      {guidance.showInputList !== false && guidance.inputs.length ? (
        <section className="evidence-list" aria-labelledby="evidence-title">
          <div className="evidence-heading">
            <Ruler size={21} aria-hidden="true" />
            <h3 id="evidence-title">Details that help</h3>
          </div>
          <ul>
            {guidance.inputs.map((input) => (
              <li key={input}>
                <CheckCircle size={17} weight="fill" aria-hidden="true" />
                {input}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {guidance.selfServeNote ? (
        <section className="self-serve-note" aria-labelledby="self-serve-title">
          <ChatCircleDots size={24} weight="duotone" aria-hidden="true" />
          <div>
            <h3 id="self-serve-title">No conversation required</h3>
            <p>{guidance.selfServeNote}</p>
          </div>
        </section>
      ) : null}

      <p className="staff-boundary">
        <ShieldCheck size={19} weight="fill" aria-hidden="true" />
        {guidance.nextAction}
      </p>

      <GuidanceActions guidance={guidance} onBack={onBack} onConfirm={onConfirm} onExit={onExit} />
    </div>
  );
}

function receiptPriceWithRequests(receipt, requests) {
  if (receipt.heatId !== "high" || !requests.private) return { label: receipt.priceLabel, price: receipt.price };
  return { label: "Private firing estimate", price: requests.rush ? "$180, or $200 if rush is fulfilled" : "$180 total" };
}

function PrintTicket({ receipt, contact, addOnRequests, ticketId, supportRequestId, printRef }) {
  if (!receipt || receipt.intentId !== "dropoff") return null;
  const referenceId = ticketId || "MF-0711-7K2P";
  const handoffText = "Optional paper copy. The studio already has the emailed ticket.";

  return (
    <article aria-hidden="true" className="print-ticket-sheet" ref={printRef}>
      <header className="print-ticket-header">
        <div>
          <p>Monsoon Fire · Firing care</p>
          <h1>Dropoff sheet</h1>
        </div>
        <strong>Ref. {referenceId}</strong>
      </header>

      <p className="print-ticket-handoff">{handoffText}</p>

      <dl className="print-ticket-summary">
        <div><dt>Artist</dt><dd>{contact.name || "Name required"}</dd></div>
        <div><dt>Email</dt><dd>{contact.email || "Not provided"}</dd></div>
        <div><dt>Firing range</dt><dd>{receipt.heat}</dd></div>
        <div><dt>Estimated space</dt><dd>{receipt.space}</dd></div>
        <div><dt>{receiptPriceWithRequests(receipt, addOnRequests).label}</dt><dd>{receiptPriceWithRequests(receipt, addOnRequests).price}</dd></div>
        {(addOnRequests.private || addOnRequests.rush || addOnRequests.communitySharing) ? <div><dt>Requests</dt><dd>{[addOnRequests.private && (receipt.heatId === "high" ? "Private firing" : "Private +$20"), addOnRequests.rush && "Tonight +$20 if fulfilled", addOnRequests.communitySharing && "Donate unused space"].filter(Boolean).join("; ")}</dd></div> : null}
        <div><dt>Handoff</dt><dd>Studio + artist email</dd></div>
      </dl>

      <section className="print-ticket-section">
        <h2>Dropoff details</h2>
        <ul>
          {receipt.inputs.map((input) => <li key={input}>□ {input}</li>)}
        </ul>
      </section>

      <section className="print-ticket-section print-ticket-note">
        <h2>Artist note</h2>
        <p>{contact.note || "No additional note."}</p>
      </section>

      <section className="print-ticket-section print-ticket-intake">
        <h2>Studio intake</h2>
        <div className="print-ticket-intake-grid">
          <span>Received: ____________________</span>
          <span>Staff: _______________________</span>
          <span>Tray / shelf: _________________</span>
          <span>Final charge: _________________</span>
        </div>
      </section>

      <footer className="print-ticket-footer">
        <p>{receipt.staffBoundary}</p>
        <p>We confirm firing fit and final price after dropoff.</p>
        <p>We’ll email the artist when the work is ready for pickup.</p>
        {supportRequestId ? <p>Studio email reference: {supportRequestId}</p> : null}
        {receipt.estimateNote ? <p className="print-ticket-estimate">{receipt.estimateNote}</p> : null}
      </footer>
    </article>
  );
}

function Receipt({
  receipt,
  copyState,
  contact,
  legalAcceptance,
  printState,
  submission,
  onContactChange,
  addOnRequests,
  onAddOnChange,
  onLegalAcceptanceChange,
  onCopy,
  onPrint,
  onSubmit,
  onChangeAnswers,
  onReset,
}) {
  const wasSubmitted = submission.status === "success";
  const successHeadingRef = useRef(null);
  const isDropoff = receipt.intentId === "dropoff";
  const isPickup = receipt.intentId === "collection";
  const isSupport = !isDropoff && !isPickup;
  const receiptLabel = isDropoff ? "Your firing plan" : isPickup ? "Pickup details" : "Your question";
  const receiptTitle = submission.ticketId
    ? `Reference ${submission.ticketId}`
    : isDropoff ? "Review your estimate" : isPickup ? "Send the details again" : "Give it a quick look";
  const formKicker = isDropoff ? "Last check" : isPickup ? "Only if you need it" : "Optional studio follow-up";
  const formTitle = isDropoff
    ? "Who should this firing ticket belong to?"
    : isPickup ? "Where should we send the pickup reminder?" : "Who should we reply to?";
  const formIntro = isDropoff
    ? "A first name, nickname, or studio name is fine. We’ll email you and the studio everything needed for the dropoff."
    : isPickup
      ? "Use the name or nickname from dropoff if you remember it. We’ll send the practical reminder and flag any private details for staff."
      : "Add a name and email only if you want the studio to follow up on this question.";
  const submitLabel = isDropoff ? "Send my firing ticket" : isPickup ? "Send pickup details" : "Send my question";
  const submittingLabel = isDropoff ? "Making your ticket…" : isPickup ? "Sending pickup details…" : "Sending your question…";

  useEffect(() => {
    if (wasSubmitted) successHeadingRef.current?.focus({ preventScroll: true });
  }, [wasSubmitted]);

  return (
    <div className="receipt-stage">
      <article
        className={`receipt${isPickup ? " receipt--pickup" : isSupport ? " receipt--support" : ""}`}
        aria-label={receiptLabel}
      >
        <header className="receipt-header">
          <div>
            <p className="micro-label">{receiptLabel}</p>
            <strong>{receiptTitle}</strong>
          </div>
          <SealCheck size={32} weight="duotone" aria-hidden="true" />
        </header>

        <dl className="receipt-summary">
          <div><dt>Service</dt><dd>{receipt.intent}</dd></div>
          {receipt.work ? <div><dt>Your work</dt><dd>{receipt.work}</dd></div> : null}
          {receipt.heat !== "Not applicable" ? (
            <div><dt>Firing range</dt><dd>{receipt.heat}</dd></div>
          ) : null}
          {receipt.space ? <div><dt>Estimated space</dt><dd>{receipt.space}</dd></div> : null}
          {isDropoff && receipt.routeName === "Fit check" ? (
            <div><dt>Studio review</dt><dd>{receipt.routeName}</dd></div>
          ) : null}
          {isDropoff ? (
            <div className="receipt-price"><dt>{receiptPriceWithRequests(receipt, addOnRequests).label}</dt><dd>{receiptPriceWithRequests(receipt, addOnRequests).price}</dd></div>
          ) : isPickup ? (
            <div className="receipt-pickup-state"><dt>Ready note</dt><dd>Already received</dd></div>
          ) : (
            <div><dt>Next</dt><dd>Studio reply by email</dd></div>
          )}
        </dl>

        {receipt.showInputList !== false && receipt.inputs.length ? (
          <section className="receipt-bring" aria-labelledby="receipt-bring-title">
            <h3 id="receipt-bring-title">
              {isDropoff ? "Details that help" : isPickup ? "Details that can help us find it" : "Include what you know"}
            </h3>
            <ul>
              {receipt.inputs.map((input) => <li key={input}>{input}</li>)}
            </ul>
          </section>
        ) : null}

        <p className="receipt-boundary">{receipt.lifecycleNote ?? receipt.staffBoundary}</p>
        {receipt.estimateNote ? <p className="receipt-estimate-note">{receipt.estimateNote}</p> : null}
      </article>

      <section className={`submission-card${wasSubmitted ? " submission-card--success" : ""}`} aria-labelledby="submission-title">
        {wasSubmitted ? (
          <div className="submission-success" role="status">
            <CheckCircle size={28} weight="fill" aria-hidden="true" />
            <div>
              <p className="micro-label">{isDropoff ? "Ticket ready" : isPickup ? "Pickup reminder sent" : "Question sent"}</p>
              <h3 id="submission-title" ref={successHeadingRef} tabIndex="-1">
                {isDropoff ? "Your dropoff is expected" : isPickup ? "Check your inbox" : "The studio has it"}
              </h3>
              <p>
                {isDropoff ? (
                  <><strong>Reference {submission.ticketId}.</strong> We emailed <strong>{contact.email}</strong> your plan, dropoff notes, kiln-risk facts, transport tips, and the human version of the studio policies. The studio has the same ticket and will email again when your work is ready.</>
                ) : isPickup ? (
                  <><strong>Reference {submission.ticketId}.</strong> We emailed <strong>{contact.email}</strong> the pickup reminder. The studio has the same note if your private address or access details need to be sent again.</>
                ) : (
                  <><strong>Reference {submission.ticketId}.</strong> The studio received your question and will reply to <strong>{contact.email}</strong>.</>
                )}
              </p>
              <div className="submission-success-actions">
                {isDropoff ? (
                  <button className="primary-button print-again-button" onClick={onPrint} type="button">
                    <Printer size={18} aria-hidden="true" />
                    Print a copy
                  </button>
                ) : null}
                <button className="secondary-button" onClick={onCopy} type="button">
                  {copyState === "copied" ? <CheckCircle size={18} weight="fill" /> : <Copy size={18} />}
                  {copyState === "copied" ? "Copied" : isDropoff ? "Copy ticket" : isPickup ? "Copy pickup note" : "Copy question"}
                </button>
              </div>
              {printState.status === "opened" ? (
                <p className="print-status">Print dialog opened. The paper copy is optional; the studio already has the ticket.</p>
              ) : null}
              {printState.status === "error" ? (
                <p className="submission-error" role="alert">{printState.error}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <form className="submission-form" onSubmit={onSubmit}>
            <div className="submission-heading">
              <PaperPlaneTilt size={25} weight="duotone" aria-hidden="true" />
              <div>
                <p className="micro-label">{formKicker}</p>
                <h3 id="submission-title">{formTitle}</h3>
                <p>{formIntro}</p>
              </div>
            </div>

            <div className="submission-fields">
              <label className="submission-field" htmlFor="artist-name">
                <span>Name or nickname</span>
                <input
                  id="artist-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength="120"
                  required
                  value={contact.name}
                  onChange={onContactChange}
                />
              </label>
              <label className="submission-field" htmlFor="artist-email">
                <span>Email {isDropoff ? <small>for the ticket + pickup notice</small> : isPickup ? <small>for the pickup reminder</small> : null}</span>
                <input
                  id="artist-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength="200"
                  required
                  value={contact.email}
                  onChange={onContactChange}
                />
              </label>
              <label className="submission-field submission-field--wide" htmlFor="artist-note">
                <span>{isDropoff ? "Clay / glaze product names, label instructions, or other notes?" : isPickup ? "Anything that helps identify the work?" : "What should the studio know?"} <small>Optional</small></span>
                <textarea
                  id="artist-note"
                  name="note"
                  maxLength="800"
                  rows="2"
                  value={contact.note}
                  onChange={onContactChange}
                />
              </label>
            </div>

            {isDropoff ? <fieldset className="submission-legal" disabled={submission.status === "submitting"}>
              <legend>Optional requests</legend>
              <label><input type="checkbox" name="private" checked={addOnRequests.private} onChange={onAddOnChange} /><span>{receipt.heatId === "high" ? "Private firing · $180 total" : "Private firing · add $20"}</span></label>
              <label><input type="checkbox" name="rush" checked={addOnRequests.rush} onChange={onAddOnChange} /><span>Fire tonight · add $20 only if we can fulfill it</span></label>
              <label><input type="checkbox" name="communitySharing" checked={addOnRequests.communitySharing} onChange={onAddOnChange} /><span>Allow unused space to be donated to community work</span></label>
            </fieldset> : null}

            <label className="submission-honeypot" aria-hidden="true" htmlFor="artist-website">
              Website
              <input
                id="artist-website"
                name="website"
                type="text"
                autoComplete="off"
                tabIndex="-1"
                value={contact.website}
                onChange={onContactChange}
              />
            </label>

            <p className="submission-consent-note">
              We use your name, email, selections, and note to create this request and send its transactional updates to you and the studio. This is transactional email permission, not marketing consent. Read the <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>

            <fieldset className="submission-legal" disabled={submission.status === "submitting"}>
              <legend>Required acknowledgments</legend>
              <label>
                <input name="termsAccepted" type="checkbox" required checked={legalAcceptance.termsAccepted} onChange={onLegalAcceptanceChange} />
                <span>I agree to the <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms of Service</a>.</span>
              </label>
              <label>
                <input name="policiesAcknowledged" type="checkbox" required checked={legalAcceptance.policiesAcknowledged} onChange={onLegalAcceptanceChange} />
                <span>I acknowledge the current <a href="/policies/" target="_blank" rel="noopener noreferrer">Studio Policies</a>, including kiln risk, billing, pickup, and storage.</span>
              </label>
            </fieldset>

            {submission.status === "error" ? (
              <p className="submission-error" role="alert">{submission.error}</p>
            ) : null}
            {printState.status === "error" ? (
              <p className="submission-error" role="alert">{printState.error}</p>
            ) : null}

            <button className="primary-button submission-button" disabled={submission.status === "submitting"} type="submit">
              <PaperPlaneTilt size={18} aria-hidden="true" />
              {submission.status === "submitting" ? submittingLabel : submitLabel}
            </button>
          </form>
        )}
      </section>

      <div className="receipt-subactions">
        {!wasSubmitted ? (
          <button className="text-button" onClick={onChangeAnswers} type="button">
            <ArrowLeft size={17} aria-hidden="true" />
            Change something
          </button>
        ) : <span />}
        <button className="text-button" onClick={onReset} type="button">
          {wasSubmitted ? "Start another plan" : "Start over"}
        </button>
      </div>
    </div>
  );
}

function initializeStateFromLocation(baseState) {
  if (typeof window !== "undefined" && window.location.hash.toLowerCase() === "#faq") {
    return demoReducer(baseState, { type: "select-entry", entryId: "other" });
  }
  return baseState;
}

export function App() {
  const [state, dispatch] = useReducer(demoReducer, initialState, initializeStateFromLocation);
  const [entryChoice, setEntryChoice] = useState(null);
  const [questionChoice, setQuestionChoice] = useState(null);
  const [heatChoice, setHeatChoice] = useState(null);
  const [spaceChoice, setSpaceChoice] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [contact, setContact] = useState({ name: "", email: "", note: "", website: "" });
  const [addOnRequests, setAddOnRequests] = useState({ private: false, rush: false, communitySharing: false });
  const [legalAcceptance, setLegalAcceptance] = useState({ ...defaultLegalAcceptance });
  const [submission, setSubmission] = useState({ status: "idle", ticketId: null, supportRequestId: null, emailQueued: false, error: null });
  const [printState, setPrintState] = useState({ status: "idle", error: null });
  const [submissionId, setSubmissionId] = useState(() => createClientRequestId());
  const [announcement, setAnnouncement] = useState("Choose a dropoff, pickup, or question.");
  const titleRef = useRef(null);
  const printSheetRef = useRef(null);
  const displayOptionsTriggerRef = useRef(null);
  const phaseFocusReadyRef = useRef(false);

  const scene = useMemo(() => getScene(state), [state]);
  const presentation = useMemo(() => getJourneyPresentation(state), [state]);
  const guidance = useMemo(() => getGuidance(state), [state]);
  const receipt = useMemo(() => getReceipt(state), [state]);

  useEffect(() => {
    if (!phaseFocusReadyRef.current) {
      phaseFocusReadyRef.current = true;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    titleRef.current?.focus({ preventScroll: true });
  }, [state.phase]);

  const reset = () => {
    dispatch({ type: "reset" });
    setEntryChoice(null);
    setQuestionChoice(null);
    setHeatChoice(null);
    setSpaceChoice(null);
    setCopyState("idle");
    setContact({ name: "", email: "", note: "", website: "" });
    setAddOnRequests({ private: false, rush: false, communitySharing: false });
    setLegalAcceptance({ ...defaultLegalAcceptance });
    setSubmission({ status: "idle", ticketId: null, supportRequestId: null, emailQueued: false, error: null });
    setPrintState({ status: "idle", error: null });
    setSubmissionId(createClientRequestId());
    setAnnouncement("You’re back at the start. Choose a dropoff, pickup, or question.");
  };

  const goBack = () => {
    dispatch({ type: "back" });
    setCopyState("idle");
    setAnnouncement("Back one step. Your earlier answers are still here.");
  };

  const returnToQuestions = () => {
    dispatch({ type: "back" });
    setQuestionChoice(null);
    setCopyState("idle");
    setAnnouncement("Back at quick answers. Choose another topic.");
  };

  const advanceEntry = (entryId) => {
    setQuestionChoice(null);
    setHeatChoice(null);
    setSpaceChoice(null);
    dispatch({ type: "select-entry", entryId });
    setAnnouncement(acknowledged(entryChoices[entryId].label));
  };

  const advanceQuestion = (questionId) => {
    setHeatChoice(null);
    setSpaceChoice(null);
    dispatch({ type: "select-question", questionId });
    setAnnouncement(acknowledged(questionChoices[questionId].label));
  };

  const advanceHeat = (heatId) => {
    setSpaceChoice(null);
    dispatch({ type: "select-heat", heatId });
    setAnnouncement(`${acknowledged(heatChoices[heatId].label)} Now choose the closest half-shelf count.`);
  };

  const advanceSpace = (spaceId) => {
    dispatch({ type: "select-space", spaceId });
    setAnnouncement(`${acknowledged(spaceChoices[spaceId].label)} Your estimate and next step are ready.`);
  };

  const submitChoice = (event) => {
    event.preventDefault();
    if (state.phase === "orient" && entryChoice) advanceEntry(entryChoice);
    else if (state.phase === "question" && questionChoice) advanceQuestion(questionChoice);
    else if (state.phase === "heat" && heatChoice) advanceHeat(heatChoice);
    else if (state.phase === "space" && spaceChoice) advanceSpace(spaceChoice);
  };

  const prepareReceipt = () => {
    dispatch({ type: "confirm-next-step" });
    setPrintState({ status: "idle", error: null });
    setAnnouncement(state.intentId === "dropoff"
      ? "Your firing plan is ready for a quick final check."
      : state.intentId === "collection"
        ? "Add an email only if you need the pickup details again."
        : "Add an email only if you want the studio to follow up.");
  };

  const copyReceipt = async () => {
    if (!receipt) return;
    try {
      const requests = [addOnRequests.private && (receipt.heatId === "high" ? "Private firing" : "Private firing +$20"), addOnRequests.rush && "Fire tonight +$20 if fulfilled", addOnRequests.communitySharing && "Donate unused space"].filter(Boolean);
      const estimate = receiptPriceWithRequests(receipt, addOnRequests);
      await copyText(`${formatReceipt({ ...receipt, priceLabel: estimate.label, price: estimate.price }, submission.ticketId)}${receipt.intentId === "dropoff" && requests.length ? `\nRequests: ${requests.join("; ")}` : ""}`);
      setCopyState("copied");
      setAnnouncement(receipt.intentId === "dropoff"
        ? "Your firing plan was copied."
        : receipt.intentId === "collection" ? "Your pickup note was copied." : "Your question was copied.");
    } catch {
      setCopyState("error");
      setAnnouncement("We couldn’t copy the plan. You can select the plan text instead.");
    }
  };

  const updateContact = (event) => {
    const { name, value } = event.target;
    setContact((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const updateLegalAcceptance = (event) => {
    const { name, checked } = event.target;
    setLegalAcceptance((current) => ({ ...current, [name]: checked }));
  };

  const validatePrintLayout = () => {
    const sheet = printSheetRef.current;
    if (!sheet || sheet.clientHeight < 1) {
      setPrintState({ status: "error", error: "The one-page ticket is not ready yet. Please try again." });
      return false;
    }
    if (sheet.scrollHeight > sheet.clientHeight + 2) {
      setPrintState({
        status: "error",
        error: "This ticket is too full for one page. Shorten the artist note, then try again.",
      });
      return false;
    }
    return true;
  };

  const openPrintDialog = () => {
    if (!validatePrintLayout()) return;
    if (typeof window.print !== "function") {
      setPrintState({ status: "error", error: "Printing is unavailable in this browser." });
      return;
    }
    setPrintState({ status: "opening", error: null });
    setAnnouncement("Opening the one-page print dialog.");
    window.print();
    setPrintState({ status: "opened", error: null });
    setAnnouncement("Print dialog opened. The paper copy is optional because the studio already has the ticket.");
  };

  const finalizeReceipt = async (event) => {
    event.preventDefault();
    if (!receipt || ["submitting", "success"].includes(submission.status)) return;
    const deliveryMode = "email";

    setPrintState({ status: "idle", error: null });
    setSubmission({ status: "submitting", ticketId: null, supportRequestId: null, emailQueued: false, error: null });
    setAnnouncement(receipt.intentId === "dropoff"
      ? "Saving your dropoff plan."
      : receipt.intentId === "collection" ? "Sending the pickup reminder." : "Sending your question.");
    try {
      const result = await submitFiringTicket({
        clientRequestId: submissionId,
        name: contact.name,
        email: contact.email,
        note: contact.note,
        consentToContact: true,
        legalAcceptance: buildLegalAcceptance(legalAcceptance),
        website: contact.website,
        deliveryMode,
        receipt,
        addOnRequests,
      });
      setSubmission({
        status: "success",
        ticketId: result.ticketId,
        supportRequestId: result.supportRequestId ?? null,
        emailQueued: Boolean(result.emailQueued),
        error: null,
      });
      setAnnouncement(result.emailQueued
        ? receipt.intentId === "dropoff"
          ? `Ticket ${result.ticketId} was emailed to you and the studio.`
          : receipt.intentId === "collection"
            ? `Pickup reminder ${result.ticketId} was emailed to you and the studio.`
            : `Question ${result.ticketId} was emailed to you and the studio.`
        : `Reference ${result.ticketId} was saved.`);
    } catch (error) {
      setSubmission({
        status: "error",
        ticketId: null,
        supportRequestId: null,
        emailQueued: false,
        error: error?.message || "We couldn’t send this yet. Your answers are still here.",
      });
      setAnnouncement("We couldn’t send this yet. Nothing was submitted or emailed.");
    }
  };

  const renderTicketBody = () => {
    if (state.phase === "orient") {
      return (
        <form onSubmit={submitChoice}>
          <ChoiceGroup
            legend="What brings you by the studio?"
            hint="Choose one, then select Continue."
            choices={entryChoices}
            icons={entryIcons}
            value={entryChoice}
            onChange={setEntryChoice}
            onAdvance={advanceEntry}
            hideLegend
          />
          <div className="ticket-actions ticket-actions--end">
            <button className="primary-button" disabled={!entryChoice} type="submit">
              Continue
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      );
    }

    if (state.phase === "question") {
      return (
        <form onSubmit={submitChoice}>
          <HelpTopicGroup
            value={questionChoice}
            onChange={setQuestionChoice}
            onAdvance={advanceQuestion}
          />
          <div className="ticket-actions">
            <BackButton onClick={goBack} />
            <button className="primary-button" disabled={!questionChoice} type="submit">
              Continue
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      );
    }

    if (state.phase === "heat") {
      return (
        <form onSubmit={submitChoice}>
          <ChoiceGroup
            legend="Which firing comes next?"
            hint="Unfired pieces usually need bisque first: choose Low fire, even if your clay is labeled mid fire. Choose Mid fire for work already bisqued and glazed. Each firing is a separate charge. Unsure? We can help check the labels."
            choices={heatChoices}
            icons={heatIcons}
            value={heatChoice}
            onChange={setHeatChoice}
            onAdvance={advanceHeat}
            hideLegend
          />
          <div className="ticket-actions">
            <BackButton onClick={goBack} />
            <button className="primary-button" disabled={!heatChoice} type="submit">
              Next: estimate kiln space
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      );
    }

    if (state.phase === "space") {
      return (
        <form onSubmit={submitChoice}>
          <SpaceChoiceGroup
            value={spaceChoice}
            heatId={state.heatId}
            onChange={setSpaceChoice}
            onAdvance={advanceSpace}
          />
          <div className="ticket-actions">
            <BackButton onClick={goBack} />
            <button className="primary-button" disabled={!spaceChoice} type="submit">
              See my estimate
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </form>
      );
    }

    if (state.phase === "guidance" && guidance) {
      return <Guidance guidance={guidance} onBack={goBack} onConfirm={prepareReceipt} onExit={returnToQuestions} />;
    }

    if (state.phase === "receipt" && receipt) {
      return (
        <Receipt
          receipt={receipt}
          copyState={copyState}
          contact={contact}
          legalAcceptance={legalAcceptance}
          printState={printState}
          submission={submission}
          onContactChange={updateContact}
          addOnRequests={addOnRequests}
          onAddOnChange={(event) => setAddOnRequests((current) => ({ ...current, [event.target.name]: event.target.checked }))}
          onLegalAcceptanceChange={updateLegalAcceptance}
          onCopy={copyReceipt}
          onPrint={openPrintDialog}
          onSubmit={finalizeReceipt}
          onChangeAnswers={() => {
            dispatch({ type: "change-answers" });
            setCopyState("idle");
            setContact({ name: "", email: "", note: "", website: "" });
            setLegalAcceptance({ ...defaultLegalAcceptance });
            setSubmission({ status: "idle", ticketId: null, supportRequestId: null, emailQueued: false, error: null });
            setPrintState({ status: "idle", error: null });
            setSubmissionId(createClientRequestId());
            setAnnouncement(
              receipt.variant === "pickup"
                ? "Your pickup reminder is open again and your details are still here."
                : receipt.variant === "support"
                  ? "Your question is open again and your details are still here."
                  : "Your firing plan is open again and your answers are still here.",
            );
          }}
          onReset={reset}
        />
      );
    }

    return null;
  };

  const titleByPhase = {
    orient: "What brings you by the studio?",
    question: "What would you like a quick answer on?",
    heat: "Which firing comes next?",
    space: "How much kiln space will your work need?",
    guidance: guidance?.title ?? "Here’s what to do next.",
    receipt: receipt?.intentId === "dropoff"
      ? "Give it a quick look."
      : receipt?.intentId === "collection" ? "Send the pickup details again." : "Send a note to the studio.",
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to planner</a>
      <div className="app-shell" data-flow={state.entryId ?? "start"} data-phase={state.phase}>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark"><img src="assets/logo-mark-black.png" alt="" /></span>
          <span className="brand-name">Monsoon Fire</span>
          <span className="brand-service">Firing Care</span>
        </div>
        <div className="header-actions">
          <a className="site-return" href="../">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to firing services
          </a>
          <DisplayOptions triggerRef={displayOptionsTriggerRef} />
          <div className="prototype-status">
            <span aria-hidden="true"></span>
            Plan your firing
          </div>
        </div>
      </header>

      <main id="main" tabIndex="-1">
        <section className="hero" aria-labelledby="page-title">
          <div>
            <p className="hero-kicker">Private home studio · West Valley, Arizona</p>
            <h1 id="page-title">Plan your <em>firing.</em></h1>
          </div>
          <p className="hero-intro">
            This optional planner estimates your firing and sends a ticket to keep your work and details together.
            Standard handoffs use the outdoor rack 24/7 once you have access instructions. First time? Email the studio or start below.
          </p>
        </section>

        <section className="workspace" aria-label="Firing planner">
          <Scene scene={scene} />

          <section
            className="work-ticket"
            data-flow={state.entryId ?? "start"}
            id={state.entryId === "other" ? "faq" : undefined}
            aria-labelledby="ticket-title"
          >
            <TicketHeader state={state} titleRef={titleRef}>
              <span id="ticket-title">{titleByPhase[state.phase]}</span>
            </TicketHeader>
            {renderTicketBody()}
          </section>

          <JourneyAtlas presentation={presentation} />
        </section>
      </main>

      <footer className="pathfinder-legal-footer" aria-label="Legal and support">
        <nav aria-label="Legal links">
          <a href="/privacy/">Privacy</a>
          <a href="/terms/">Terms</a>
          <a href="/policies/">Studio Policies</a>
          <a href="/accessibility/">Accessibility</a>
          <a href="mailto:support@monsoonfire.com">Email support</a>
        </nav>
        <p>© 2026 Monsoon Fire Pottery Studio. Monsoon Fire is the studio’s trade name.</p>
      </footer>

        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </div>
      <PrintTicket
        receipt={receipt}
        contact={contact}
        addOnRequests={addOnRequests}
        ticketId={submission.ticketId}
        supportRequestId={submission.supportRequestId}
        printRef={printSheetRef}
      />
    </>
  );
}
