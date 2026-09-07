"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string };
export function Dropdown({ id, value, options, onValueChange, disabled = false, "aria-label": ariaLabel }: {
	id?: string; value: string; options: readonly Option[];
	onValueChange: (value: string) => void; disabled?: boolean; "aria-label"?: string;
}) {
	const generatedId = useId();
	const controlId = id || generatedId;
	const listId = `${controlId}-options`;
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const search = useRef({ text: "", time: 0 });
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const activeIndex = useRef(0);
	function highlight(index: number) { activeIndex.current = index; setActive(index); }
	const selected = Math.max(0, options.findIndex(option => option.value === value));
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", dismiss);
		return () => document.removeEventListener("pointerdown", dismiss);
	}, [open]);
	useEffect(() => {
		const menu = list.current;
		const option = menu?.children[active] as HTMLElement | undefined;
		if (!open || !menu || !option) return;
		if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
		else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
			menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
	}, [open, active]);
	function show() { highlight(selected); setOpen(true); search.current.text = ""; }
	function choose(index: number) {
		if (disabled || trigger.current?.matches(":disabled") || !options[index]) return;
		onValueChange(options[index].value); setOpen(false); trigger.current?.focus();
	}
	function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key === "Tab") { setOpen(false); return; }
		if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
		if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
			event.preventDefault();
			if (event.key === "Enter" || event.key === " ") { if (open) choose(activeIndex.current); else show(); return; }
			if (!open) { show(); return; }
			highlight(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (activeIndex.current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
		} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			const now = Date.now();
			const text = (now - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase();
			search.current = { text, time: now };
			const index = options.findIndex(option => option.label.toLowerCase().startsWith(text));
			if (index >= 0) { highlight(index); setOpen(true); }
		}
	}
	return <div className="dropdown" ref={root} onBlur={event => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
	}}>
		<button ref={trigger} id={controlId} type="button" role="combobox" className="dropdown-trigger"
			aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open && !disabled}
			aria-controls={open && !disabled ? listId : undefined} aria-activedescendant={open && !disabled ? `${listId}-${active}` : undefined}
			disabled={disabled || !options.length} onKeyDown={keyDown} onClick={() => open ? setOpen(false) : show()}>
			<span>{options.find(option => option.value === value)?.label || "Choose an option"}</span><ChevronDown size={16} aria-hidden="true" />
		</button>
		{open && !disabled && <div ref={list} id={listId} className="dropdown-menu" role="listbox" aria-labelledby={controlId}>
			{options.map((option, index) => <div id={`${listId}-${index}`} key={option.value} role="option"
				aria-selected={option.value === value} className={`dropdown-option ${index === active ? "highlighted" : ""}`}
				onPointerMove={event => { if (event.movementX || event.movementY) highlight(index); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
				<span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
			</div>)}
		</div>}
	</div>;
}
