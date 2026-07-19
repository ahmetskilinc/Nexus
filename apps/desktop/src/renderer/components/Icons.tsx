import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrain01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Bug01Icon,
  Cancel01Icon,
  CheckmarkSquare03Icon,
  ColorPickerIcon,
  Compass01Icon,
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  Edit02Icon,
  File01Icon,
  FileEditIcon,
  Folder01Icon,
  ChevronUpIcon as HuChevronUpIcon,
  FlashIcon as HuFlashIcon,
  FolderOpenIcon as HuFolderOpenIcon,
  GitBranchIcon as HuGitBranchIcon,
  GlobeIcon as HuGlobeIcon,
  HelpCircleIcon as HuHelpCircleIcon,
  MoreHorizontalIcon as HuMoreHorizontalIcon,
  PinIcon as HuPinIcon,
  StopIcon as HuStopIcon,
  TerminalIcon as HuTerminalIcon,
  InformationCircleIcon,
  Moon02Icon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  SlidersHorizontalIcon,
  Sun03Icon,
  Tick02Icon,
  User03Icon,
  Wrench01Icon,
} from "@hugeicons-pro/core-stroke-rounded";

type IconProps = {
  size?: number;
  className?: string;
  color?: string;
  strokeWidth?: number;
};

function make(icon: IconSvgElement) {
  return function Icon({
    size = 16,
    className,
    color,
    strokeWidth = 1.8,
  }: IconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={size}
        className={className}
        color={color}
        strokeWidth={strokeWidth}
      />
    );
  };
}

export type IconComponent = ReturnType<typeof make>;

export const PlusIcon = make(Add01Icon);
export const FolderIcon = make(Folder01Icon);
export const FolderOpenIcon = make(HuFolderOpenIcon);
export const FileIcon = make(File01Icon);
export const TerminalIcon = make(HuTerminalIcon);
export const GlobeIcon = make(HuGlobeIcon);
export const ReviewIcon = make(CheckmarkSquare03Icon);
export const SelectIcon = make(CheckmarkSquare03Icon);
export const SettingsIcon = make(Settings01Icon);
export const CompassIcon = make(Compass01Icon);
export const WrenchIcon = make(Wrench01Icon);
export const BugIcon = make(Bug01Icon);
export const ChevronUpIcon = make(HuChevronUpIcon);
export const StopIcon = make(HuStopIcon);
export const SearchIcon = make(Search01Icon);
export const CloseIcon = make(Cancel01Icon);
export const CheckIcon = make(Tick02Icon);
export const ChevronDownIcon = make(ArrowDown01Icon);
export const ChevronRightIcon = make(ArrowRight01Icon);
export const ChevronLeftIcon = make(ArrowLeft01Icon);
export const GitBranchIcon = make(HuGitBranchIcon);
export const SunIcon = make(Sun03Icon);
export const MoonIcon = make(Moon02Icon);
export const MonitorIcon = make(ComputerIcon);
export const PanelLeftIcon = make(SidebarLeft01Icon);
export const PanelRightIcon = make(SidebarRight01Icon);
export const SlidersIcon = make(SlidersHorizontalIcon);
export const PaletteIcon = make(ColorPickerIcon);
export const AiIcon = make(AiBrain01Icon);
export const InfoIcon = make(InformationCircleIcon);
export const FlashIcon = make(HuFlashIcon);
export const HelpIcon = make(HuHelpCircleIcon);
export const ComposeIcon = make(Edit02Icon);
export const WriteFileIcon = make(FileEditIcon);
export const DeleteIcon = make(Delete02Icon);
export const UserIcon = make(User03Icon);
export const CopyIcon = make(Copy01Icon);
export const PinIcon = make(HuPinIcon);
export const MoreHorizontalIcon = make(HuMoreHorizontalIcon);
export const DownloadIcon = make(Download01Icon);
