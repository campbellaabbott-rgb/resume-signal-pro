import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagListEditor } from "./TagListEditor";

describe("TagListEditor", () => {
  it("renders existing tags", () => {
    render(<TagListEditor tags={["React", "TypeScript"]} onChange={vi.fn()} />);
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("adds a tag when typing and pressing Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagListEditor tags={[]} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/type and press enter/i);
    await user.type(input, "Python{Enter}");

    expect(onChange).toHaveBeenCalledWith(["Python"]);
  });

  it("does not add a duplicate tag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagListEditor tags={["Python"]} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/type and press enter/i);
    await user.type(input, "Python{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag when its remove button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagListEditor tags={["React", "Vue"]} onChange={onChange} />);

    const reactTag = screen.getByText("React").closest("span")!;
    const removeButton = reactTag.querySelector("button")!;
    await user.click(removeButton);

    expect(onChange).toHaveBeenCalledWith(["Vue"]);
  });

  it("removes the last tag on Backspace when the input is empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagListEditor tags={["React", "Vue"]} onChange={onChange} />);

    const input = screen.getByPlaceholderText(/type and press enter/i);
    await user.click(input);
    await user.keyboard("{Backspace}");

    expect(onChange).toHaveBeenCalledWith(["React"]);
  });
});
