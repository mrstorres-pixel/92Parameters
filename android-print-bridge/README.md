# 92 Parameters Print Bridge

Android Bluetooth ESC/POS print bridge for 58mm paired thermal printers.

## How To Use

1. Open this `android-print-bridge` folder in Android Studio.
2. Let Android Studio sync Gradle.
3. Connect the Android tablet by USB and install/run the app.
4. Pair the Bluetooth thermal printer in Android settings first.
5. Open the bridge app, select the paired printer, tap `Save Printer`, then `Test Print`.
6. In the web POS receipt modal, tap `Bluetooth Print`.

## Web Deep Link

The POS calls:

```text
parametersprint://print?payload=<url-encoded-json>
```

The bridge also accepts shared plain text or JSON through Android `ACTION_SEND`.

## Notes

- This targets common SPP Bluetooth ESC/POS printers using UUID `00001101-0000-1000-8000-00805F9B34FB`.
- Some mini printers use nonstandard commands. If test print connects but prints unreadable text, the printer may not be ESC/POS compatible.
- Paper width is formatted around 32 characters per line for 58mm paper.
